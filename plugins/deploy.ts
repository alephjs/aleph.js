import { colors, esbuild, path } from "../server/deps.ts";
import type { Router } from "../framework/core/routes.ts";
import depGraph, { DependencyGraph } from "../server/graph.ts";
import log from "../server/log.ts";
import { getAlephConfig, getAppDir, getImportMap, getJSXConfig } from "../server/helpers.ts";
import type { Plugin } from "../server/types.ts";
import { isFilledArray, prettyBytes, trimPrefix } from "../shared/util.ts";

/** A plugin for Deno Deploy which doesn't support the dynamic import. */
export default function DenoDeployPlugin({ modules }: { modules: Record<string, Record<string, unknown>> }): Plugin {
  return {
    name: "deploy",
    setup(aleph, env) {
      if (env.isDev) {
        aleph.router = { ...aleph.router, onChange: generateExportTs };
        return;
      }
      if (isFilledArray(modules.depGraph?.modules)) {
        modules.depGraph.modules.forEach((module) => {
          depGraph.mark(module.specifier, module);
        });
      }
      aleph.router = { ...aleph.router, modules };
      log.debug(`[deno deploy] load ${Object.keys(modules).length} router modules`);
    },
  };
}

let esbuildCtx: esbuild.BuildContext | null = null;

/** generate the `_export.ts` module by given the routes config. */
export async function generateExportTs() {
  const config = getAlephConfig();
  const router: Router | undefined = Reflect.get(globalThis, "__ALEPH_ROUTER");
  if (!config || !router) {
    return;
  }

  const { loaders } = config;
  const appDir = getAppDir();
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

  // stop running esbuild context
  if (esbuildCtx) {
    await esbuildCtx.dispose();
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
    esbuildCtx = await esbuild.context({
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
    await esbuildCtx.watch();
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

// close the esbuild context when the process is exiting
globalThis.addEventListener("unload", () => {
  esbuildCtx?.dispose();
});
