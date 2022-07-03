import log from "../lib/log.ts";
import util from "../lib/util.ts";
import { basename, blue, dirname, esbuild, join, mitt, relative, serve, serveTls } from "./deps.ts";
import depGraph from "./graph.ts";
import {
  builtinModuleExts,
  findFile,
  getAlephConfig,
  globalIt,
  loadImportMap,
  loadJSXConfig,
  watchFs,
} from "./helpers.ts";
import { initRoutes, toRouteRegExp } from "./routing.ts";
import type { AlephConfig, ConnInfo, Emitter, ModuleLoader, RouteConfig } from "./types.ts";

type WatchFsEvents = {
  [key in "create" | "remove" | `modify:${string}` | `hotUpdate:${string}`]: { specifier: string };
};

const watchFsEmitters = new Set<Emitter<WatchFsEvents>>();

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
  /** The base URL. */
  baseUrl?: string;
  /** The url for the HMR web socket. This is useful for dev server proxy mode. */
  hmrWebSocketUrl?: string;
};

/** Watch for file changes and listen the dev server. */
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

  // set log level to debug when debug aleph.js itself.
  if (import.meta.url.startsWith("file:")) {
    log.setLevel("debug");
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

  const emitter = createWatchFsEmitter();
  emitter.on(`modify:./${basename(serverEntry)}`, start);
  // todo: watch server deps

  // update global route config when fs changess
  emitter.on("*", async (kind, { specifier }) => {
    const config = getAlephConfig();
    if (config?.routes) {
      if (kind === "create" || kind === "remove") {
        const reg = toRouteRegExp(config.routes);
        if (reg.test(specifier)) {
          const routeConfig = await initRoutes(config.routes, appDir);
          Reflect.set(globalThis, "__ALEPH_ROUTE_CONFIG", routeConfig);
          generateRoutesExportModule({
            routeConfig,
            loaders: config.loaders,
          }).catch((err) => log.error(err));
        }
      } else if (config.loaders?.some((l) => l.test(specifier))) {
        const routeConfig: RouteConfig | undefined = Reflect.get(globalThis, "__ALEPH_ROUTE_CONFIG");
        if (routeConfig) {
          generateRoutesExportModule({
            routeConfig,
            loaders: config.loaders,
          }).catch((err) => log.error(err));
        }
      }
    } else {
      Reflect.set(globalThis, "__ALEPH_ROUTE_CONFIG", null);
    }
  });

  log.info("Watching for file changes...");
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
      emitter.emit(kind, { specifier });
    }
  });

  await start();
}

/** Bootstrap the dev server, handle the HMR socket connection. */
async function bootstrap(signal: AbortSignal, entry: string, appDir: string, __port?: number) {
  // clean globally cached objects
  Reflect.deleteProperty(globalThis, "__ALEPH_SERVER");
  Reflect.deleteProperty(globalThis, "__ALEPH_INDEX_HTML");
  Reflect.deleteProperty(globalThis, "__ALEPH_IMPORT_MAP");
  Reflect.deleteProperty(globalThis, "__ALEPH_JSX_CONFIG");
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
export async function generateRoutesExportModule(options: GenerateOptions) {
  const { routeConfig, loaders } = options;
  const appDir = routeConfig.appDir ?? Deno.cwd();
  const genFile = join(appDir, routeConfig.prefix, "_export.ts");

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
    const importUrl = JSON.stringify("." + util.trimPrefix(filename, routeConfig.prefix));
    imports.push(`import * as $${idx} from ${importUrl};`);
    revives.push(`  ${JSON.stringify(pattern.pathname)}: $${idx},`);
  });

  if (routeConfig.routes.some(([_, { filename }]) => loaders?.some((l) => l.test(filename)))) {
    const input = [
      ...imports,
      "export default {",
      "__DEP_GRAPH__:null,",
      ...revives,
      "}",
    ].join("\n");
    const output = await esbuild({
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
            if (args.path.startsWith(".") && loaders?.some((l) => l.test(args.path))) {
              const dir = dirname(genFile);
              const specifier = "./" + relative(appDir, join(dir, args.path));
              depGraph.mark(specifier, {});
              if (args.importer.startsWith(".")) {
                const importer = "./" + relative(appDir, join(dir, args.importer));
                depGraph.mark(importer, { deps: [{ specifier }] });
              }
              return { path: args.path, namespace: "loader" };
            }
            return { path: args.path, external: true };
          });
          build.onLoad({ filter: /.*/, namespace: "loader" }, async (args) => {
            const loader = loaders?.find((l) => l.test(args.path));
            if (loader) {
              const fullpath = join(dirname(genFile), args.path);
              const specifier = "./" + relative(appDir, fullpath);
              const importMap = await globalIt("__ALEPH_IMPORT_MAP", () => loadImportMap(appDir));
              const jsxConfig = await globalIt("__ALEPH_JSX_CONFIG", () => loadJSXConfig(appDir));
              const source = await Deno.readTextFile(fullpath);
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
              };
            }
            throw new Error(`Loader not found for ${args.path}`);
          });
        },
      }],
    });
    await Promise.all(output.outputFiles.map(async (file) => {
      if (file.path === genFile) {
        await Deno.writeTextFile(
          genFile,
          file.text.replace(
            "__DEP_GRAPH__:null,",
            // deno-lint-ignore no-unused-vars
            `__DEP_GRAPH__:${JSON.stringify(depGraph.modules.map(({ version, ...module }) => module))},`,
          ),
        );
      }
    }));
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
  log.debug(`${blue(`${routeConfig.prefix}/_export.ts`)} generated in ${Math.round(performance.now() - start)}ms`);
}
