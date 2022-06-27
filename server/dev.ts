import { join } from "https://deno.land/std@0.144.0/path/mod.ts";
import { parseDeps, parseExportNames } from "https://deno.land/x/aleph_compiler@0.6.4/mod.ts";
import type { RouteConfig } from "../framework/core/route.ts";
import log, { blue } from "../lib/log.ts";
import util from "../lib/util.ts";
import { initRoutes, toRouteRegExp } from "./routing.ts";
import { createFsEmitter, removeFsEmitter, watchFs } from "./watch_fs.ts";
import type { AlephConfig } from "./types.ts";

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
          generateRoutesModule(routeConfig, appDir).catch((error) => log.error(error));
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
        generateRoutesModule(routeConfig, appDir).catch((error) => log.error(error));
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

/** generate the `routes.gen.ts` module follows the routes config */
async function generateRoutesModule(routeConfig: RouteConfig, appDir?: string) {
  const genFile = appDir ? join(appDir, "routes.gen.ts") : "routes.gen.ts";

  try {
    const sourceCode = await Deno.readTextFile(genFile);
    const deps = await parseDeps("./routes.gen.ts", sourceCode);
    if (
      routeConfig.routes.every((route) =>
        deps.findIndex(({ specifier }) => {
          const filename = appDir ? "." + util.trimPrefix(route[1].filename, appDir) : route[1].filename;
          return specifier === filename;
        }) >= 0
      )
    ) {
      return;
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  const routeFiles: [filename: string, exportNames: string[]][] = await Promise.all(
    routeConfig.routes.map(async ([_, { filename }]) => {
      const code = await Deno.readTextFile(filename);
      const exportNames = await parseExportNames(filename, code);
      return [filename, exportNames];
    }),
  );

  const imports: string[] = [];
  const revives: string[] = [];

  routeFiles.forEach(([filename, exportNames], idx) => {
    const hasDefaultExport = exportNames.includes("default");
    const hasNameExports = exportNames.filter((name) => name !== "default").length > 0;
    const importUrl = JSON.stringify(appDir ? "." + util.trimPrefix(filename, appDir) : filename);
    if (hasDefaultExport) {
      imports.push(`import d${idx} from ${importUrl};`);
    }
    if (hasNameExports) {
      imports.push(`import * as m${idx} from ${importUrl};`);
    }
    if (hasDefaultExport && hasNameExports) {
      revives.push(`  ${JSON.stringify(filename)}: { ...m${idx}, default: d${idx} },`);
    } else if (hasDefaultExport) {
      revives.push(`  ${JSON.stringify(filename)}: { default: d${idx} },`);
    } else if (hasNameExports) {
      revives.push(`  ${JSON.stringify(filename)}: m${idx},`);
    }
  });

  if (revives.length > 0) {
    await Deno.writeTextFile(
      genFile,
      [
        "/*! Generated by Aleph.js, do NOT change and NO git-ignore. */",
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
