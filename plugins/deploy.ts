import { colors, esbuild, path } from "../server/deps.ts";
import type { Router } from "../framework/core/router.ts";
import depGraph, { DependencyGraph } from "../server/graph.ts";
import log from "../server/log.ts";
import { fetchCode, getAlephConfig, getAlephPkgUri, getAppDir, getImportMap, getJSXConfig } from "../server/helpers.ts";
import type { Plugin } from "../server/types.ts";
import { isFilledArray, isLikelyHttpURL, prettyBytes, trimPrefix } from "../shared/util.ts";

type PluginOptions = {
  moduleMain?: string;
  modules: Record<string, Record<string, unknown>>;
};

/** A plugin for Deno Deploy which doesn't support the dynamic import. */
export default function DenoDeployPlugin({ moduleMain, modules }: PluginOptions): Plugin {
  return {
    name: "deploy",
    setup(aleph, env) {
      if (env.isDev) {
        aleph.router = { ...aleph.router, onChange: generateExportTs };
        return;
      }
      if (moduleMain) {
        Reflect.set(globalThis, "__ALEPH_APP_DIR", path.dirname(path.fromFileUrl(moduleMain)));
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
  const alephPkgUri = getAlephPkgUri();
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
    "// This module will be updated automatically in development mode, do NOT edit it manually.",
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

  const moduleURL = config.router?.moduleURL;
  if (moduleURL && isLikelyHttpURL(moduleURL) && loaders?.some((l) => l.test(moduleURL))) {
    imports.push(`import * as $router from ${JSON.stringify(moduleURL)};`);
    revives.push(`  __router__: $router,`);
  }

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
      stdin: { contents: input, resolveDir: routesDir },
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
        name: "aleph-deploy-plugin",
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.path === moduleURL) {
              return { path: args.path, namespace: "loader", pluginData: { specifier: args.path } };
            }
            if (args.importer === moduleURL) {
              if (loaders?.some((l) => l.test(args.path))) {
                return {
                  path: args.path,
                  namespace: "loader",
                  pluginData: { specifier: new URL(args.path, args.importer).href },
                };
              } else if (args.path.startsWith(".")) {
                let specifier = new URL(args.path, args.importer).href;
                if (specifier.startsWith(alephPkgUri + "/")) {
                  specifier = "aleph/" + trimPrefix(specifier, alephPkgUri + "/");
                }
                return { path: specifier, external: true };
              }
            }
            if (
              args.path.startsWith(".") &&
              loaders?.some((l) => l.test(args.path))
            ) {
              const specifier = "./" +
                path.relative(appDir, path.join(routesDir, path.join(path.dirname(args.importer), args.path)));
              depGraph.mark(specifier, {});
              if (args.importer.startsWith(".")) {
                const importer = "./" + path.relative(appDir, path.join(routesDir, args.importer));
                depGraph.mark(importer, { deps: [{ specifier }] });
              }
              return { path: args.path, namespace: "loader", pluginData: { specifier } };
            }
            return { path: args.path, external: true };
          });
          build.onLoad({ filter: /.*/, namespace: "loader" }, async (args) => {
            const loader = loaders?.find((l) => l.test(args.path));
            if (loader) {
              const specifier = args.pluginData.specifier;
              const isRemote = isLikelyHttpURL(specifier);
              const [importMap, jsxConfig, source] = await Promise.all([
                getImportMap(appDir),
                getJSXConfig(appDir),
                isRemote
                  ? fetchCode(specifier).then(([code]) => code)
                  : Deno.readTextFile(path.join(appDir, specifier)),
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
                  watchFiles: !isRemote ? [path.join(appDir, specifier)] : undefined,
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
