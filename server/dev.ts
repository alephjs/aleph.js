import { basename, join, relative } from "https://deno.land/std@0.145.0/path/mod.ts";
import { serve, serveTls } from "https://deno.land/std@0.145.0/http/mod.ts";
import mitt, { Emitter } from "https://esm.sh/mitt@3.0.0";
import type { RouteConfig } from "../framework/core/route.ts";
import log, { blue } from "../lib/log.ts";
import util from "../lib/util.ts";
import { builtinModuleExts, findFile, getAlephConfig, getFiles } from "./helpers.ts";
import { initRoutes, toRouteRegExp } from "./routing.ts";
import type { DependencyGraph } from "./graph.ts";
import type { AlephConfig } from "./types.ts";

export type FsEvents = {
  [key in "create" | "remove" | `modify:${string}` | `hotUpdate:${string}`]: { specifier: string };
};

export const emitters = new Set<Emitter<FsEvents>>();

export function createFsEmitter() {
  const e = mitt<FsEvents>();
  emitters.add(e);
  return e;
}

export function removeFsEmitter(e: Emitter<FsEvents>) {
  e.all.clear();
  emitters.delete(e);
}

/** The options for dev server. */
export type DevOptions = {
  baseUrl?: string;
  /** The url for the HMR web socket. This is useful for dev server proxy mode. */
  hmrWebSocketUrl?: string;
};

export default async function dev(options?: DevOptions) {
  const appDir = options?.baseUrl ? new URL(".", options.baseUrl).pathname : Deno.cwd();
  const serverEntry = await findFile(builtinModuleExts.map((ext) => `server.${ext}`), appDir);
  if (!serverEntry) {
    log.error(`Could not find the server entry file.`);
    Deno.exit(1);
  }

  Deno.env.set("ALEPH_ENV", "development");
  if (options?.hmrWebSocketUrl) {
    Deno.env.set("ALEPH_HMR_WS_URL", options?.hmrWebSocketUrl);
  }

  let ac: AbortController | null = null;
  const start = async () => {
    if (ac) {
      ac.abort();
      log.info(`Restart server...`);
    }
    ac = new AbortController();
    await bootstrap(ac.signal, serverEntry, appDir);
  };

  const emitter = createFsEmitter();
  emitter.on(`modify:./${basename(serverEntry)}`, start);
  // todo: watch server deps

  // update global route config when fs changess
  const updateRoutes = async ({ specifier }: { specifier: string }) => {
    const config = getAlephConfig();
    if (config?.routes) {
      const reg = toRouteRegExp(config.routes);
      if (reg.test(specifier)) {
        const routeConfig = await initRoutes(config.routes, appDir);
        Reflect.set(globalThis, "__ALEPH_ROUTE_CONFIG", routeConfig);
        generateRoutesExportModule(routeConfig, appDir).catch((error) => log.error(error));
      }
    } else {
      Reflect.set(globalThis, "__ALEPH_ROUTE_CONFIG", null);
    }
  };
  emitter.on("create", updateRoutes);
  emitter.on("remove", updateRoutes);

  log.info("Watching for file changes...");
  watchFs(appDir);

  await start();
}

async function bootstrap(signal: AbortSignal, entry: string, appDir: string, __port?: number) {
  // clean globally cached objects
  Reflect.deleteProperty(globalThis, "__ALEPH_SERVER");
  Reflect.deleteProperty(globalThis, "__ALEPH_INDEX_HTML");
  Reflect.deleteProperty(globalThis, "__UNO_GENERATOR");

  if (Deno.env.get("ALEPH_SERVER_ENTRY") !== entry) {
    Deno.env.set("ALEPH_SERVER_ENTRY", entry);
    log.info(`Bootstrap server from ${blue(basename(entry))}...`);
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

  const config = getAlephConfig();
  if (config?.routes) {
    const routeConfig = await initRoutes(config.routes, appDir);
    Reflect.set(globalThis, "__ALEPH_ROUTE_CONFIG", routeConfig);
    generateRoutesExportModule(routeConfig, appDir).catch((error) => log.error(error));
  }

  const { port: portOption, hostname, certFile, keyFile, handler } = Reflect.get(globalThis, "__ALEPH_SERVER");
  const port = __port || portOption || 3000;
  try {
    if (certFile && keyFile) {
      await serveTls(handler, {
        port,
        hostname,
        certFile,
        keyFile,
        signal,
        onListen: ({ port }) => log.info(`Server ready on https://localhost:${port}`),
      });
    } else {
      await serve(handler, {
        port,
        hostname,
        signal,
        onListen: ({ port }) => log.info(`Server ready on http://localhost:${port}`),
      });
    }
  } catch (error) {
    if (error instanceof Deno.errors.AddrInUse) {
      log.warn(`Port ${port} is in use, try ${port + 1}...`);
      await bootstrap(signal, entry, appDir, port + 1);
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
          emitter.on(`hotUpdate:${specifier}`, () => {
            send({ type: "modify", specifier });
          });
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

/** generate the `routes/_export.ts` module by given the routes config */
export async function generateRoutesExportModule(routeConfig: RouteConfig, appDir: string) {
  const genFile = join(appDir, routeConfig.prefix, "_export.ts");

  const routeFiles: [filename: string, pattern: string, hasExportKeyword: boolean][] = await Promise.all(
    routeConfig.routes.map(async ([_, { filename, pattern }]) => {
      const code = await Deno.readTextFile(join(appDir, filename));
      return [
        filename,
        pattern.pathname,
        /export\s+(default|const|let|var|function|class)/.test(code),
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
        "// Imports route modules for serverless env that doesn't support the dynamic import.",
        "// This module will be updated automaticlly in develoment mode, do NOT edit it manually.",
        "",
        ...imports,
        "",
        "export default {",
        ...revives,
        "};",
        "",
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

/* watch the directory and its subdirectories */
export async function watchFs(rootDir = Deno.cwd()) {
  const timers = new Map();
  const debounce = (id: string, callback: () => void, delay: number) => {
    if (timers.has(id)) {
      clearTimeout(timers.get(id)!);
    }
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        callback();
      }, delay),
    );
  };
  const listener = (kind: "create" | "remove" | "modify", path: string) => {
    const specifier = "./" + relative(rootDir, path).replaceAll("\\", "/");
    const depGraph: DependencyGraph | undefined = Reflect.get(globalThis, "__ALEPH_DEP_GRAPH");
    if (kind === "remove") {
      depGraph?.unmark(specifier);
    } else {
      depGraph?.update(specifier);
    }
    // delete global cached index html
    if (specifier === "./index.html") {
      Reflect.deleteProperty(globalThis, "__ALEPH_INDEX_HTML");
    }
    if (kind === "modify") {
      emitters.forEach((e) => {
        e.emit(`modify:${specifier}`, { specifier });
        if (e.all.has(`hotUpdate:${specifier}`)) {
          e.emit(`hotUpdate:${specifier}`, { specifier });
        } else if (specifier !== "./routes/_export.ts") {
          depGraph?.lookup(specifier, (specifier) => {
            if (e.all.has(`hotUpdate:${specifier}`)) {
              e.emit(`hotUpdate:${specifier}`, { specifier });
              return false;
            }
          });
        }
      });
    }
  };
  const reIgnore = /[\/\\](\.git(hub)?|\.vscode|vendor|node_modules|dist|out(put)?|target)[\/\\]/;
  const ignore = (path: string) => reIgnore.test(path) || path.endsWith(".DS_Store");
  const allFiles = new Set<string>(
    (await getFiles(rootDir)).map((name) => join(rootDir, name)).filter((path) => !ignore(path)),
  );
  for await (const { kind, paths } of Deno.watchFs(rootDir, { recursive: true })) {
    if (kind !== "create" && kind !== "remove" && kind !== "modify") {
      continue;
    }
    for (const path of paths) {
      if (ignore(path)) {
        continue;
      }
      debounce(kind + path, async () => {
        try {
          await Deno.lstat(path);
          if (!allFiles.has(path)) {
            allFiles.add(path);
            listener("create", path);
          } else {
            listener("modify", path);
          }
        } catch (error) {
          if (error instanceof Deno.errors.NotFound) {
            allFiles.delete(path);
            listener("remove", path);
          } else {
            console.warn("watchFs:", error);
          }
        }
      }, 100);
    }
  }
}
