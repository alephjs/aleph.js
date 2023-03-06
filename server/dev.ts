import { isFilledString, prettyBytes, trimPrefix } from "../shared/util.ts";
import type { Router } from "../runtime/core/routes.ts";
import { colors, Emitter, ensureDir, esbuild, mitt, parseDeps, path } from "./deps.ts";
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
import log from "./log.ts";
import { initRouter, toRouteRegExp } from "./routing.ts";
import type { AlephConfig, ModuleLoader } from "./types.ts";

type WatchFsEvents = {
  [key in "create" | "remove" | "modify" | `modify:${string}` | `hotUpdate:${string}`]: {
    specifier: string;
  };
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

/** Watch for file changes. */
export function watch(appDir: string, shouldGenerateExportTs: boolean) {
  const config = getAlephConfig();
  const emitter = createWatchFsEmitter();

  emitter.on("*", async (kind, { specifier }) => {
    if (kind === "create" || kind === "remove") {
      // reload router when fs changess
      const reg = toRouteRegExp(config?.router);
      if (reg.test(specifier)) {
        const router = await initRouter(config?.router, appDir);
        Reflect.set(globalThis, "__ALEPH_ROUTER", router);
        if (shouldGenerateExportTs) {
          generateExportTs(appDir, router, config?.loaders).catch((err) => log.error(err));
        }
      }
    }
  });

  if (shouldGenerateExportTs) {
    initRouter(config?.router, appDir).then((router) => {
      Reflect.set(globalThis, "__ALEPH_ROUTER", router);
      generateExportTs(appDir, router, config?.loaders).catch((err) => log.error(err));
    });
  }

  watchFs(appDir, (kind: "create" | "remove" | "modify", pathname: string) => {
    const specifier = "./" + path.relative(appDir, pathname).replaceAll("\\", "/");
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
}

export type DevOptions = {
  baseUrl?: string;
  /** The server entry, default is `server.{ts,tsx,js,jsx}` */
  serverEntry?: string;
  /** Whether to generate the `./routes/_export.ts` module for serverless env that doesn't support dynamic import. */
  generateExportTs?: boolean;
};

let devProcess: Deno.Process | null = null;
let watched = false;

export default async function dev(options?: DevOptions) {
  const appDir = options?.baseUrl ? path.fromFileUrl(new URL(".", options.baseUrl)) : Deno.cwd();
  const serverEntry = options?.serverEntry
    ? path.join(appDir, options?.serverEntry)
    : await findFile(builtinModuleExts.map((ext) => `server.${ext}`), appDir);

  if (!watched) {
    log.info(colors.dim("[dev]"), "Watching for file changes...");
    watch(appDir, false);
    watched = true;
  }

  if (!serverEntry) {
    log.fatal("[dev] No server entry found.");
    return;
  }

  const entry = `./${trimPrefix(serverEntry, appDir)}`;
  const source = await Deno.readTextFile(serverEntry);
  const importMap = await getImportMap();
  const deps = await parseDeps(entry, source, {
    importMap: JSON.stringify(importMap),
  });
  const exportTs = deps.find((dep) => dep.specifier.startsWith("./") && dep.specifier.endsWith("/_export.ts"));

  // ensure the `_export.ts` file exists
  if (exportTs) {
    const fp = path.join(appDir, exportTs.specifier);
    if (!(await existsFile(fp))) {
      await ensureDir(path.dirname(fp));
      await Deno.writeTextFile(fp, "export default {}");
    }
  }

  // watch server entry and its deps to restart the dev server
  const emitter = createWatchFsEmitter();
  emitter.on("*", (kind, { specifier }) => {
    if (
      kind === "modify" && specifier !== exportTs?.specifier && (
        specifier === entry ||
        deps.some((dep) => dep.specifier === specifier)
      )
    ) {
      console.clear();
      console.info(colors.dim("[dev] Restarting the server..."));
      devProcess?.kill("SIGTERM");
      dev(options);
    }
  });

  const cmd = [Deno.execPath(), "run", "-A", "--no-lock", serverEntry, "--dev"];
  if (options?.generateExportTs) {
    cmd.push("--generate");
  }
  devProcess = Deno.run({ cmd, stderr: "inherit", stdout: "inherit" });
  await devProcess.status();
  removeWatchFsEmitter(emitter);
}

export function handleHMR(req: Request): Response {
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
    if (isFilledString(e.data)) {
      try {
        const { type, specifier } = JSON.parse(e.data);
        if (type === "hotAccept" && isFilledString(specifier)) {
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

/** generate the `routes/_export.ts` module by given the routes config. */
export async function generateExportTs(appDir: string, router: Router, loaders?: ModuleLoader[]) {
  const routesDir = path.join(appDir, router.prefix);
  const exportTsFile = path.join(routesDir, "_export.ts");
  const withLoader = router.routes.some(([_, { filename }]) => loaders?.some((l) => l.test(filename)));

  if (router.routes.length == 0) {
    try {
      await Deno.remove(exportTsFile);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
    return;
  }

  const comments = [
    "// Exports router modules for serverless env that doesn't support the dynamic import.",
    "// This module will be updated automaticlly in develoment mode, do NOT edit it manually.",
  ];
  const imports: string[] = [];
  const revives: string[] = [];

  router.routes.forEach(([_, { filename, pattern }], idx) => {
    const importUrl = JSON.stringify(
      "." + trimPrefix(filename, router.prefix),
    );
    imports.push(`import * as $${idx} from ${importUrl};`);
    revives.push(`  ${JSON.stringify(pattern.pathname)}: $${idx},`);
  });

  // stop previous esbuild context
  const prevCtx: esbuild.BuildContext | undefined = Reflect.get(globalThis, "__ESBUILD_CTX");
  if (prevCtx) {
    Reflect.deleteProperty(globalThis, "__ESBUILD_CTX");
    prevCtx.dispose?.();
  }

  if (withLoader) {
    const depGraph = new DependencyGraph();
    const input = [
      ...imports,
      "export default {",
      ...revives,
      "__ALEPH_DEP_GRAPH_PLACEHOLDER__:null,",
      "}",
    ].join("\n");
    const write = async (build: esbuild.BuildResult) => {
      await Promise.all(build.outputFiles!.map(async (file) => {
        if (file.path === exportTsFile) {
          await Deno.writeTextFile(
            exportTsFile,
            file.text.replace(
              "__ALEPH_DEP_GRAPH_PLACEHOLDER__:null",
              // deno-lint-ignore no-unused-vars
              `depGraph:${JSON.stringify({ modules: depGraph.modules.map(({ version, ...module }) => module) })}`,
            ),
          );
          log.debug(`${colors.blue("_export.ts")} updated ${colors.dim(prettyBytes(file.text.length))} by esbuld`);
        }
      }));
    };
    const ctx = await esbuild.context({
      stdin: { contents: input },
      outfile: exportTsFile,
      platform: "browser",
      format: "esm",
      target: "esnext",
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
        name: "aleph-loader",
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (
              args.path.startsWith(".") &&
              loaders?.some((l) => l.test(args.path))
            ) {
              const specifier = "./" + path.relative(appDir, path.join(routesDir, args.path));
              depGraph.mark(specifier, {});
              if (args.importer.startsWith(".")) {
                const importer = "./" + path.relative(appDir, path.join(routesDir, args.importer));
                depGraph.mark(importer, { deps: [{ specifier }] });
              }
              return { path: args.path, namespace: "loader" };
            }
            return { path: args.path, external: true };
          });
          build.onLoad({ filter: /.*/, namespace: "loader" }, async (args) => {
            const loader = loaders?.find((l) => l.test(args.path));
            if (loader) {
              const fullpath = path.join(routesDir, args.path);
              const specifier = "./" + path.relative(appDir, fullpath);
              const [importMap, jsxConfig, source] = await Promise.all([
                getImportMap(appDir),
                getJSXConfig(appDir),
                Deno.readTextFile(fullpath),
              ]);
              try {
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
              } catch (error) {
                return {
                  errors: [{ text: error.message }],
                };
              }
            }
            return {
              errors: [{ text: `Loader not found for ${args.path}` }],
            };
          });
          build.onEnd((res) => {
            write(res);
          });
        },
      }],
    });
    await ctx.watch();
    Reflect.set(globalThis, "__ESBUILD_CTX", ctx);
    addEventListener("unload", () => {
      ctx.dispose();
    });
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
    await Deno.writeTextFile(exportTsFile, code);
    log.debug(`${colors.blue("_export.ts")} updated`);
  }
}

if (import.meta.main) {
  dev({ generateExportTs: Deno.args.includes("--generate") });
}
