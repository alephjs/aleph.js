import log from "../lib/log.ts";
import util from "../lib/util.ts";
import type { BuildResult, Emitter } from "./deps.ts";
import { basename, blue, esbuild, fromFileUrl, join, mitt, relative, serve, serveTls } from "./deps.ts";
import depGraph, { DependencyGraph } from "./graph.ts";
import {
  builtinModuleExts,
  existsFile,
  findFile,
  getAlephConfig,
  getImportMap,
  getJSXConfig,
  watchFs,
} from "./helpers.ts";
import { initRoutes, toRouteRegExp } from "./routing.ts";
import type { AlephConfig, ConnInfo, ModuleLoader, RouteConfig } from "./types.ts";

type WatchFsEvents = {
  [key in "create" | "remove" | "modify" | `modify:${string}` | `hotUpdate:${string}`]: {
    specifier: string;
  };
};

const watchFsEmitters = new Set<Emitter<WatchFsEvents>>();
const defaultEmitter = createWatchFsEmitter();

/** Create a `watchFs` emitter. */
export function createWatchFsEmitter() {
  const e = mitt<WatchFsEvents>();
  watchFsEmitters.add(e);
  return e;
}

/** Remove the emitter. */
export function removeWatchFsEmitter(e: Emitter<WatchFsEvents>) {
  e.all.clear();
  watchFsEmitters.delete(e);
}

/** The options for dev server. */
export type DevOptions = {
  /** The entry of the server. Default is `server.{tsx,ts,jsx,js}`. */
  serverEntry?: string;
  /** The base URL. */
  baseUrl?: string;
  /** The url for the HMR web socket. This is useful for dev server proxy mode. */
  hmrWebSocketUrl?: string;
};

/** Watch for file changes and listen the dev server. */
export default async function dev(options?: DevOptions) {
  const appDir = options?.baseUrl ? fromFileUrl(new URL(".", options.baseUrl)) : Deno.cwd();
  const serverEntry = options?.serverEntry ? join(appDir, options.serverEntry) : await findFile(
    builtinModuleExts.map((ext) => `server.${ext}`),
    appDir,
  );
  if (!serverEntry || !(await existsFile(serverEntry))) {
    log.error(`Could not find the server entry.`);
    Deno.exit(1);
  }

  Deno.env.set("ALEPH_ENV", "development");
  if (options?.hmrWebSocketUrl) {
    Deno.env.set("ALEPH_HMR_WS_URL", options?.hmrWebSocketUrl);
  }

  // set log level to debug when debug aleph.js itself.
  if (import.meta.url.startsWith("file:")) {
    log.setLevel("debug");
  }

  let ac: AbortController | null = null;
  const start = async () => {
    if (ac) {
      ac.abort();
      log.info(`[dev] Restart server...`);
    }
    ac = new AbortController();
    await bootstrap(ac.signal, serverEntry, appDir);
  };

  defaultEmitter.on(`modify:./${relative(appDir, serverEntry)}`, start);
  // todo: watch server deps to restart the server

  // update global route config when fs changess
  defaultEmitter.on("*", async (kind, { specifier }) => {
    const config = getAlephConfig();
    if (config) {
      if (config.router) {
        if (kind === "create" || kind === "remove") {
          const reg = toRouteRegExp(config.router);
          if (reg.test(specifier)) {
            const routeConfig = await initRoutes(config.router, appDir);
            Reflect.set(globalThis, "__ALEPH_ROUTE_CONFIG", routeConfig);
            generateRoutesExportModule({
              routeConfig,
              loaders: config.loaders,
            }).catch((err) => log.error(err));
          }
        }
      } else {
        Reflect.set(globalThis, "__ALEPH_ROUTE_CONFIG", null);
      }
    }
  });

  log.info("[dev] Watching for file changes...");
  watchFs(appDir, (kind: "create" | "remove" | "modify", path: string) => {
    const specifier = "./" + relative(appDir, path).replaceAll("\\", "/");
    // delete global cached index html
    if (specifier === "./index.html") {
      Reflect.deleteProperty(globalThis, "__ALEPH_INDEX_HTML");
    }
    if (kind === "remove") {
      depGraph.unmark(specifier);
    } else {
      depGraph.update(specifier);
    }
    if (kind === "modify") {
      watchFsEmitters.forEach((e) => {
        e.emit("modify", { specifier });
        e.emit(`modify:${specifier}`, { specifier });
        if (e.all.has(`hotUpdate:${specifier}`)) {
          e.emit(`hotUpdate:${specifier}`, { specifier });
        } else if (specifier !== "./routes/_export.ts") {
          depGraph.lookup(specifier, (specifier) => {
            if (e.all.has(`hotUpdate:${specifier}`)) {
              e.emit(`hotUpdate:${specifier}`, { specifier });
              return false;
            }
          });
        }
      });
    } else {
      watchFsEmitters.forEach((e) => e.emit(kind, { specifier }));
    }
  });

  // generate empty `./routes/_export.ts` if not exists
  const entryCode = await Deno.readTextFile(serverEntry);
  const m = entryCode.match(/ from "(\.\/.+\/_export.ts)"/);
  if (m) {
    const exportTs = join(appDir, m[1]);
    if (!(await existsFile(exportTs))) {
      await Deno.writeTextFile(exportTs, "export default {}");
    }
  }

  await start();
}

/** Bootstrap the dev server, handle the HMR socket connection. */
async function bootstrap(signal: AbortSignal, entry: string, appDir: string, __port?: number) {
  // remove globally cached objects
  Reflect.deleteProperty(globalThis, "__ALEPH_CONFIG");
  Reflect.deleteProperty(globalThis, "__ALEPH_SERVER");
  Reflect.deleteProperty(globalThis, "__ALEPH_ROUTE_CONFIG");
  Reflect.deleteProperty(globalThis, "__ALEPH_INDEX_HTML");
  Reflect.deleteProperty(globalThis, "__ALEPH_IMPORT_MAP");
  Reflect.deleteProperty(globalThis, "__ALEPH_JSX_CONFIG");
  Reflect.deleteProperty(globalThis, "__UNO_GENERATOR");

  if (Deno.env.get("ALEPH_SERVER_ENTRY") !== entry) {
    Deno.env.set("ALEPH_SERVER_ENTRY", entry);
    log.info(`[dev] Bootstrap server from ${blue(basename(entry))}...`);
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
  if (config?.router) {
    const routeConfig = await initRoutes(config.router, appDir);
    Reflect.set(globalThis, "__ALEPH_ROUTE_CONFIG", routeConfig);
    generateRoutesExportModule({
      routeConfig,
      loaders: config.loaders,
    }).catch((err) => log.error(err));
  } else {
    Reflect.set(globalThis, "__ALEPH_ROUTE_CONFIG", null);
  }

  const server = Reflect.get(globalThis, "__ALEPH_SERVER");
  const { hostname, certFile, keyFile } = server;
  const useTls = certFile && keyFile;
  const port = __port ?? server.port ?? 3000;
  const handler = async (req: Request, connInfo: ConnInfo): Promise<Response> => {
    const { pathname } = new URL(req.url);
    if (pathname === "/-/hmr") {
      const { socket, response } = Deno.upgradeWebSocket(req);
      const emitter = createWatchFsEmitter();
      const send = (message: Record<string, unknown>) => {
        try {
          socket.send(JSON.stringify(message));
        } catch (err) {
          log.warn("socket.send:", err.message);
        }
      };
      socket.addEventListener("close", () => {
        removeWatchFsEmitter(emitter);
      });
      socket.addEventListener("open", () => {
        emitter.on("create", ({ specifier }) => {
          const config: AlephConfig | undefined = Reflect.get(
            globalThis,
            "__ALEPH_CONFIG",
          );
          if (config?.router) {
            const reg = toRouteRegExp(config.router);
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
      return response;
    }
    return await server.handler(req, connInfo);
  };
  const onListen = (arg: { hostname: string; port: number }) => {
    Deno.env.set("ALEPH_DEV_SERVER_PORT", arg.port.toString());
    log.info(`Server ready on http${useTls ? "s" : ""}://localhost:${port}`);
    server.onListen?.(arg);
  };

  try {
    if (useTls) {
      await serveTls(handler, { hostname, port, certFile, keyFile, signal, onListen });
    } else {
      await serve(handler, { hostname, port, signal, onListen });
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

/** The options for generating the `routes/_export.ts` module. */
export type GenerateOptions = {
  routeConfig: RouteConfig;
  loaders?: ModuleLoader[];
};

/** generate the `routes/_export.ts` module by given the routes config. */
async function generateRoutesExportModule(options: GenerateOptions) {
  const { routeConfig, loaders } = options;
  const appDir = routeConfig.appDir ?? Deno.cwd();
  const routesDir = join(appDir, routeConfig.prefix);
  const genFile = join(routesDir, "_export.ts");
  const useLoader = routeConfig.routes.some(([_, { filename }]) => loaders?.some((l) => l.test(filename)));

  if (routeConfig.routes.length == 0) {
    try {
      await Deno.remove(genFile);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
    return;
  }

  const start = performance.now();
  const comments = [
    "// Imports route modules for serverless env that doesn't support the dynamic import.",
    "// This module will be updated automaticlly in develoment mode, do NOT edit it manually.",
  ];
  const imports: string[] = [];
  const revives: string[] = [];

  routeConfig.routes.forEach(([_, { filename, pattern }], idx) => {
    const importUrl = JSON.stringify(
      "." + util.trimPrefix(filename, routeConfig.prefix),
    );
    imports.push(`import * as $${idx} from ${importUrl};`);
    revives.push(`  ${JSON.stringify(pattern.pathname)}: $${idx},`);
  });

  // stop previous esbuild watcher
  const preResult: BuildResult | undefined = Reflect.get(
    globalThis,
    "__ALEPH_PREV_ESBUILD_RES",
  );
  if (preResult) {
    Reflect.deleteProperty(globalThis, "__ALEPH_PREV_ESBUILD_RES");
    preResult.stop?.();
  }

  if (useLoader) {
    const input = [
      ...imports,
      "export default {",
      ...revives,
      "__ALEPH_DEP_GRAPH_PLACEHOLDER__:null,",
      "}",
    ].join("\n");
    const depGraph = new DependencyGraph();
    const write = async (build: BuildResult) => {
      await Promise.all(build.outputFiles!.map(async (file) => {
        if (file.path === genFile) {
          log.debug(`writing ${blue(`${routeConfig.prefix}/_export.ts`)}...`);
          await Deno.writeTextFile(
            genFile,
            file.text.replace(
              "__ALEPH_DEP_GRAPH_PLACEHOLDER__:null",
              // deno-lint-ignore no-unused-vars
              `depGraph:${JSON.stringify({ modules: depGraph.modules.map(({ version, ...module }) => module) })}`,
            ),
          );
        }
      }));
    };
    const result = await esbuild({
      stdin: {
        sourcefile: genFile,
        contents: input,
      },
      outfile: genFile,
      platform: "browser",
      format: "esm",
      target: ["esnext"],
      bundle: true,
      minify: true,
      treeShaking: true,
      // todo: enable sourcemap
      sourcemap: false,
      write: false,
      banner: {
        js: [
          ...comments,
          "// deno-fmt-ignore-file",
          "// deno-lint-ignore-file",
          "// @ts-nocheck",
        ].join("\n"),
      },
      plugins: [{
        name: "bundle-non-standard-modules",
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.path === "dep-graph") {
              return { path: args.path, namespace: "dep-graph" };
            }
            if (
              args.path.startsWith(".") &&
              loaders?.some((l) => l.test(args.path))
            ) {
              const specifier = "./" + relative(appDir, join(routesDir, args.path));
              depGraph.mark(specifier, {});
              if (args.importer.startsWith(".")) {
                const importer = "./" + relative(appDir, join(routesDir, args.importer));
                depGraph.mark(importer, { deps: [{ specifier }] });
              }
              return { path: args.path, namespace: "loader" };
            }
            return { path: args.path, external: true };
          });
          build.onLoad({ filter: /.*/, namespace: "loader" }, async (args) => {
            const loader = loaders?.find((l) => l.test(args.path));
            if (loader) {
              const fullpath = join(routesDir, args.path);
              const specifier = "./" + relative(appDir, fullpath);
              const [importMap, jsxConfig, source] = await Promise.all([
                getImportMap(appDir),
                getJSXConfig(appDir),
                Deno.readTextFile(fullpath),
              ]);
              const { code, lang, inlineCSS } = await loader.load(specifier, source, {
                importMap,
                jsxConfig,
                ssr: true,
              });
              if (inlineCSS) {
                depGraph.mark(specifier, { inlineCSS });
              }
              return {
                contents: code,
                loader: lang,
                watchFiles: [fullpath],
              };
            }
            throw new Error(`Loader not found for ${args.path}`);
          });
          build.onLoad({ filter: /.*/, namespace: "dep-graph" }, () => {
            return {
              contents: `export default ${
                // deno-lint-ignore no-unused-vars
                JSON.stringify({ modules: depGraph.modules.map(({ version, ...module }) => module) })};`,
              loader: "js",
            };
          });
        },
      }],
      watch: {
        onRebuild(error, result) {
          if (error) log.warn("[esbuild] watch build failed:", error);
          else write(result!);
        },
      },
    });
    Reflect.set(globalThis, "__ALEPH_PREV_ESBUILD_RES", result);
    await write(result);
  } else {
    const empty = "";
    const code = [
      ...comments,
      empty,
      ...imports,
      empty,
      "export default {",
      ...revives,
      "};",
      empty,
    ].join("\n");
    await Deno.writeTextFile(genFile, code);
  }
  log.debug(
    `[dev] ${blue(`${routeConfig.prefix}/_export.ts`)} generated in ${Math.round(performance.now() - start)}ms`,
  );
}
