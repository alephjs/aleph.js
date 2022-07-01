import { basename, join } from "https://deno.land/std@0.145.0/path/mod.ts";
import { serve, serveTls } from "https://deno.land/std@0.145.0/http/mod.ts";
import type { RouteConfig } from "../framework/core/route.ts";
import log, { blue } from "../lib/log.ts";
import util from "../lib/util.ts";
import { builtinModuleExts, findFile } from "./helpers.ts";
import { initRoutes, toRouteRegExp } from "./routing.ts";
import { createFsEmitter, removeFsEmitter, watchFs } from "./watch_fs.ts";
import type { AlephConfig } from "./types.ts";

export default async function dev() {
  Deno.env.set("ALEPH_ENV", "development");

  const serverEntry = await findFile(builtinModuleExts.map((ext) => `server.${ext}`));
  if (!serverEntry) {
    log.error(`Could not find server entry file.`);
    Deno.exit(1);
  }

  let ac: AbortController | null = null;
  const start = async () => {
    if (ac) {
      ac.abort();
      log.info(`Restart server...`);
    }
    ac = new AbortController();
    await bootstrap(ac.signal, serverEntry);
  };

  const emitter = createFsEmitter();
  emitter.on(`modify:./${basename(serverEntry)}`, start);
  // todo: watch server deps

  await start();
}

async function bootstrap(signal: AbortSignal, entry: string, fixedPort?: number) {
  // clean globally cached objects
  Reflect.deleteProperty(globalThis, "__ALEPH_SERVER");
  Reflect.deleteProperty(globalThis, "__ALEPH_INDEX_HTML");
  Reflect.deleteProperty(globalThis, "__UNO_GENERATOR");

  if (Deno.env.get("ALEPH_SERVER_ENTRY") !== entry) {
    Deno.env.set("ALEPH_SERVER_ENTRY", entry);
    log.info(`Bootstrap server from ${blue(entry)}...`);
  }

  try {
    await import(`file://${entry}#${Date.now().toString(16)}`);
  } catch (error) {
    log.error(`Can't bootstrap server from ${blue(entry)}:`, error);
    return;
  }

  if (!Reflect.has(globalThis, "__ALEPH_SERVER")) {
    console.warn("No server found");
    Deno.exit(0);
  }

  const { port: portOption, hostname, certFile, keyFile, handler } = Reflect.get(globalThis, "__ALEPH_SERVER") || {};
  const port = fixedPort || portOption || 8080;
  try {
    if (certFile && keyFile) {
      await serveTls(handler, {
        port,
        hostname,
        certFile,
        keyFile,
        signal,
        onListen: ({ hostname, port }) => log.info(`Server ready on https://${hostname}:${port}`),
      });
    } else {
      await serve(handler, {
        port,
        hostname,
        signal,
        onListen: (port) => log.info(`Server ready on http://${hostname}:${port}`),
      });
    }
  } catch (error) {
    if (error instanceof Deno.errors.AddrInUse) {
      log.warn(`Port ${port} is in use, try ${port + 1}...`);
      await bootstrap(signal, entry, port + 1);
    } else {
      throw error;
    }
  }
}

export function handleHMRSocket(req: Request): Response {
  const { socket, response } = Deno.upgradeWebSocket(req, {});
  const emitter = createFsEmitter();
  const send = (message: Record<string, unknown>) => {
    try {
      socket.send(JSON.stringify(message));
    } catch (err) {
      log.warn("socket.send:", err.message);
    }
  };
  socket.addEventListener("open", () => {
    emitter.on("create", ({ specifier }) => {
      const config: AlephConfig | undefined = Reflect.get(globalThis, "__ALEPH_CONFIG");
      if (config && config.routes) {
        const reg = toRouteRegExp(config.routes);
        const routePattern = reg.exec(specifier);
        if (routePattern) {
          send({ type: "create", specifier, routePattern });
          return;
        }
      }
      send({ type: "create", specifier });
    });
    emitter.on("remove", ({ specifier }) => {
      emitter.off(`hotUpdate:${specifier}`);
      send({ type: "remove", specifier });
    });
  });
  socket.addEventListener("message", (e) => {
    if (util.isFilledString(e.data)) {
      try {
        const { type, specifier } = JSON.parse(e.data);
        if (type === "hotAccept" && util.isFilledString(specifier)) {
          emitter.on(
            `hotUpdate:${specifier}`,
            () => send({ type: "modify", specifier }),
          );
        }
      } catch (_e) {
        log.error("invlid socket message:", e.data);
      }
    }
  });
  socket.addEventListener("close", () => {
    removeFsEmitter(emitter);
  });
  return response;
}

export function watchFS(appDir?: string) {
  const config: AlephConfig | undefined = Reflect.get(globalThis, "__ALEPH_CONFIG");
  const emitter = createFsEmitter();

  // update global route config when fs changess
  const updateRoutes = async ({ specifier }: { specifier: string }) => {
    if (config?.routes) {
      const reg = toRouteRegExp(config.routes);
      if (reg.test(specifier)) {
        const routeConfig = await initRoutes(reg, appDir);
        Reflect.set(globalThis, "__ALEPH_ROUTE_CONFIG", routeConfig);
        if (!Deno.env.get("ALEPH_CLI")) {
          generateRoutesExportModule(routeConfig).catch((error) => log.error(error));
        }
      }
    } else {
      Reflect.set(globalThis, "__ALEPH_ROUTE_CONFIG", null);
    }
  };
  emitter.on("create", updateRoutes);
  emitter.on("remove", updateRoutes);

  if (config?.routes) {
    initRoutes(config.routes, appDir).then((routeConfig) => {
      Reflect.set(globalThis, "__ALEPH_ROUTE_CONFIG", routeConfig);
      if (!Deno.env.get("ALEPH_CLI")) {
        generateRoutesExportModule(routeConfig).catch((error) => log.error(error));
      }
    });
  }

  // apply user `watchFS` handler
  if (typeof config?.devServer?.watchFS === "function") {
    const { watchFS } = config.devServer;
    emitter.on("*", (kind, { specifier }) => {
      if (kind.startsWith("modify:")) {
        watchFS("modify", specifier);
      } else if (kind === "create" || kind === "remove") {
        watchFS(kind, specifier);
      }
    });
  }

  log.info(`Watching files for changes...`);
  watchFs(appDir);
}

/** generate the `routes/_export.ts` module by given the routes config */
export async function generateRoutesExportModule(routeConfig: RouteConfig, cwd = Deno.cwd()) {
  const genFile = join(cwd, routeConfig.prefix, "_export.ts");

  const routeFiles: [filename: string, pattern: string, hasExportKeyword: boolean][] = await Promise.all(
    routeConfig.routes.map(async ([_, { filename, pattern }]) => {
      const code = await Deno.readTextFile(join(cwd, filename));
      return [
        filename,
        pattern.pathname,
        code.includes("export default") || code.includes("export const") || code.includes("export function"),
      ];
    }),
  );

  const imports: string[] = [];
  const revives: string[] = [];

  routeFiles.forEach(([filename, pattern, hasExportKeyword], idx) => {
    if (hasExportKeyword) {
      const importUrl = JSON.stringify("." + util.trimPrefix(filename, routeConfig.prefix));
      imports.push(`import * as $${idx} from ${importUrl};`);
      revives.push(`  ${JSON.stringify(pattern)}: $${idx},`);
    }
  });

  if (revives.length > 0) {
    await Deno.writeTextFile(
      genFile,
      [
        "// Exports route modules for serverless env that doesn't support the dynamic imports.",
        "// This module will be updated automaticlly in develoment mode, do NOT edit it manually.",
        "",
        ...imports,
        "",
        "export default {",
        ...revives,
        "}",
      ].join("\n"),
    );
    log.debug(`${blue("routes.gen.ts")} generated`);
  } else {
    try {
      await Deno.remove(genFile);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  }
}
