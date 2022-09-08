import util from "../shared/util.ts";
import { BuildResult, dim, dirname, Emitter, ensureDir, parseDeps } from "./deps.ts";
import { esbuild, fromFileUrl, join, mitt, relative } from "./deps.ts";
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
import type { AlephConfig, ModuleLoader, Router } from "./types.ts";

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

/** Watch for file changes and listen the dev server. */
export function watch(appDir = Deno.cwd()) {
  const config = getAlephConfig();
  const emitter = createWatchFsEmitter();

  emitter.on("*", async (kind, { specifier }) => {
    if (config?.router) {
      if (kind === "create" || kind === "remove") {
        // reload router when fs changess
        const reg = toRouteRegExp(config.router);
        if (reg.test(specifier)) {
          const router = await initRouter(config.router, appDir);
          Reflect.set(globalThis, "__ALEPH_ROUTER", router);
          if (config.ssr) {
            generateExportTs(appDir, router, config.loaders).catch((err) => log.error(err));
          }
        }
      }
    } else {
      Reflect.set(globalThis, "__ALEPH_ROUTER", null);
    }
  });

  if (config?.router) {
    initRouter(config.router, appDir).then((router) => {
      Reflect.set(globalThis, "__ALEPH_ROUTER", router);
      generateExportTs(appDir, router, config.loaders).catch((err) => log.error(err));
    });
  } else {
    Reflect.set(globalThis, "__ALEPH_ROUTER", null);
  }

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
}

export type DevOptions = {
  baseUrl?: string;
  serverEntry?: string;
};

let devProcess: Deno.Process | null = null;
let watched = false;

export default async function dev(options?: DevOptions) {
  // stop previous dev server
  if (devProcess) {
    devProcess.kill("SIGTERM");
    devProcess.close();
  }

  const appDir = options?.baseUrl ? fromFileUrl(new URL(".", options.baseUrl)) : Deno.cwd();
  const serverEntry = options?.serverEntry
    ? join(appDir, options?.serverEntry)
    : await findFile(builtinModuleExts.map((ext) => `server.${ext}`), appDir);
  if (serverEntry) {
    const serverSpecifier = `./${util.trimPrefix(serverEntry, appDir)}`;
    const source = await Deno.readTextFile(serverEntry);
    const importMap = getImportMap();
    const deps = await parseDeps(serverSpecifier, source, {
      importMap: JSON.stringify(importMap),
    });

    // ensure the `_export.ts` file exists
    for (const dep of deps) {
      if (dep.specifier.startsWith("./") && dep.specifier.endsWith("/_export.ts")) {
        const fp = join(appDir, dep.specifier);
        await ensureDir(dirname(fp));
        await Deno.writeTextFile(fp, "export default {}");
      }
    }

    if (!watched) {
      log.info("[dev] Watching for file changes...");
      watch(appDir);
      watched = true;
    }

    const emitter = createWatchFsEmitter();
    emitter.on("*", (kind, { specifier }) => {
      if (
        kind === "modify" && (
          specifier === serverSpecifier ||
          deps.some((dep) => !dep.specifier.endsWith("/_export.ts") && dep.specifier === specifier)
        )
      ) {
        dev(options);
      }
    });

    const cmd = [Deno.execPath(), "run", "-A", serverEntry, "--dev"];
    if (Deno.args.includes("--optimize")) {
      cmd.push("--optimize");
    }
    if (devProcess) {
      console.debug(dim("Restarting the server..."));
    }
    devProcess = Deno.run({ cmd, stderr: "inherit", stdout: "inherit" });
    await devProcess.status();
    removeWatchFsEmitter(emitter);
  }
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

/** generate the `routes/_export.ts` module by given the routes config. */
export async function generateExportTs(appDir: string, router: Router, loaders?: ModuleLoader[]) {
  const routesDir = join(appDir, router.prefix);
  const genFile = join(routesDir, "_export.ts");
  const withLoader = router.routes.some(([_, { filename }]) => loaders?.some((l) => l.test(filename)));

  if (router.routes.length == 0) {
    try {
      await Deno.remove(genFile);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
    return;
  }

  const comments = [
    "// Imports route modules for serverless env that doesn't support the dynamic import.",
    "// This module will be updated automaticlly in develoment mode, do NOT edit it manually.",
  ];
  const imports: string[] = [];
  const revives: string[] = [];

  router.routes.forEach(([_, { filename, pattern }], idx) => {
    const importUrl = JSON.stringify(
      "." + util.trimPrefix(filename, router.prefix),
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

  if (withLoader) {
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
          await stealWriteTextFile(
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
    await stealWriteTextFile(genFile, code);
  }
}

async function stealWriteTextFile(filename: string, content: string) {
  if (await existsFile(filename)) {
    const oldContent = await Deno.readTextFile(filename);
    if (oldContent === content) {
      return;
    }
  }
  await Deno.writeTextFile(filename, content);
}
