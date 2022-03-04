import { basename, extname, join, resolve } from "https://deno.land/std@0.125.0/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.125.0/fs/ensure_dir.ts";
import { build, type Loader, stop } from "https://deno.land/x/esbuild@v0.14.23/mod.js";
import { parseExportNames } from "../compiler/mod.ts";
import { parse } from "../lib/flags.ts";
import { existsDir, findFile } from "../lib/fs.ts";
import { builtinModuleExts } from "../lib/helpers.ts";
import log, { blue } from "../lib/log.ts";
import util from "../lib/util.ts";
import { getAlephPkgUri, loadImportMap, loadJSXConfig } from "../server/config.ts";
import { DependencyGraph } from "../server/graph.ts";
import { serveAppModules } from "../server/transformer.ts";
import { initRoutes } from "../server/routing.ts";
import type { AlephConfig } from "../server/types.ts";

export const helpMessage = `
Usage:
    aleph build <dir> [...options]

<dir> represents the directory of Aleph.js app,
if the <dir> is empty, the current directory will be used.

Options:
    -L, --log-level <log-level>  Set log level [possible values: debug, info]
    -h, --help                   Prints help message
`;

if (import.meta.main) {
  const start = performance.now();
  const { args } = parse();

  // check working dir
  const workingDir = resolve(String(args[0] || "."));
  if (!await existsDir(workingDir)) {
    log.fatal("No such directory:", workingDir);
  }
  Deno.chdir(workingDir);

  serveAppModules(6060, await loadImportMap());
  log.debug(`Serve app modules on http://localhost:${Deno.env.get("ALEPH_APP_MODULES_PORT")}`);

  const port = Deno.env.get("ALEPH_APP_MODULES_PORT");
  const serverEntry = await findFile(workingDir, builtinModuleExts.map((ext) => `server.${ext}`));
  if (serverEntry) {
    await import(
      `http://localhost:${port}/${basename(serverEntry)}?t=${Date.now().toString(16)}`
    );
    log.info(`Server handler imported from ${blue(basename(serverEntry))}`);
  } else {
    throw new Error("No server entry found");
  }

  const tmpDir = await Deno.makeTempDir();
  const alephPkgUri = getAlephPkgUri();
  const jsxCofig = await loadJSXConfig();
  const config: AlephConfig | undefined = Reflect.get(globalThis, "__ALEPH_SERVER_CONFIG");
  const outputDir = config?.build?.outputDir ?? "dist";

  // const buildTarget = config?.build?.target ?? "es2015";
  // todo: build client modules
  // todo: ssg

  let routeFiles: [filename: string, exportNames: string[]][] = [];
  if (config?.routeFiles) {
    const routes = await initRoutes(config?.routeFiles);
    routeFiles = await Promise.all(routes.map(async ([_, { filename }]) => {
      const code = await Deno.readTextFile(filename);
      const exportNames = await parseExportNames(filename, code);
      return [filename, exportNames];
    }));
  }
  const entryCode = [
    `import { DependencyGraph } from "${alephPkgUri}/server/graph.ts";`,
    `import { modules } from "./server_dependency_graph.js";`,
    `globalThis.serverDependencyGraph = new DependencyGraph(modules);`,
    routeFiles.length > 0 && `import { register } from "${alephPkgUri}/server/routing.ts";`,
    ...routeFiles.map(([filename, exportNames], idx) => {
      const hasDefaultExport = exportNames.includes("default");
      const hasDataExport = exportNames.includes("data");
      if (!hasDefaultExport && !hasDataExport) {
        return [];
      }
      const url = `http://localhost:${port}${filename.slice(1)}`;
      return [
        hasDefaultExport && `import _${idx} from ${JSON.stringify(url)};`,
        !hasDefaultExport && `const _${idx} = undefined;`,
        hasDataExport && `import { data as $${idx} } from ${JSON.stringify(url)};`,
        !hasDataExport && `const $${idx} = undefined;`,
        `register(${JSON.stringify(filename)}, { default: _${idx}, data: $${idx} });`,
      ];
    }).flat().filter(Boolean),
    `import "http://localhost:${port}/${basename(serverEntry)}";`,
  ].filter(Boolean).join("\n");

  // since esbuild doesn't support jsx automic mode, we need to manually import jsx runtime
  let jsxShimFile: string | null = null;
  if (jsxCofig.jsxImportSource) {
    jsxShimFile = join(tmpDir, "jsx-shim.js");
    await Deno.writeTextFile(
      jsxShimFile,
      (jsxCofig.jsxRuntime === "preact"
        ? [
          `import { h, Fragment } from ${JSON.stringify(jsxCofig.jsxImportSource)};`,
          `export { h, Fragment }`,
        ]
        : [
          `import React from ${JSON.stringify(jsxCofig.jsxImportSource)};`,
          `export { React }`,
        ]).join("\n"),
    );
  }

  log.info("Building...");
  await ensureDir(join(workingDir, outputDir));
  await build({
    stdin: {
      contents: entryCode,
      sourcefile: "server.tsx",
    },
    outfile: join(workingDir, outputDir, "server.js"),
    platform: "browser",
    format: "esm",
    target: ["esnext"],
    bundle: true,
    minify: true,
    treeShaking: true,
    sourcemap: true,
    jsxFactory: jsxCofig.jsxRuntime === "preact" ? "h" : "React.createElement",
    jsxFragment: jsxCofig.jsxRuntime === "preact" ? "Fragment" : "React.Fragment",
    inject: [jsxShimFile as string].filter(Boolean),
    plugins: [{
      name: "aleph-build",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          const isRemote = util.isLikelyHttpURL(args.path);
          const isLocalUrl = args.path.startsWith(`http://localhost:${Deno.env.get("ALEPH_APP_MODULES_PORT")}/`);
          const [path] = util.splitBy(isRemote ? args.path : util.trimPrefix(args.path, "file://"), "#");

          if ((isRemote && !isLocalUrl) || args.path === "./server_dependency_graph.js") {
            return { path, external: true };
          }

          if (isLocalUrl) {
            return { path, namespace: "http" };
          }

          if (args.namespace === "http") {
            return {
              path: (new URL(path, args.importer)).toString(),
              namespace: "http",
            };
          }

          return { path };
        });
        build.onLoad({ filter: /.*/, namespace: "http" }, async (args) => {
          const { pathname } = new URL(args.path);
          const contents = await (await fetch(args.path)).text();
          return {
            contents,
            loader: extname(pathname).slice(1) as unknown as Loader,
          };
        });
      },
    }],
  });

  const serverDependencyGraph: DependencyGraph | undefined = Reflect.get(globalThis, "serverDependencyGraph");
  if (serverDependencyGraph) {
    await Deno.writeTextFile(
      join(workingDir, outputDir, "server_dependency_graph.js"),
      "export default " + JSON.stringify({ modules: serverDependencyGraph.modules }),
    );
  }

  log.info(`Done in ${(performance.now() - start)}ms`);

  // clean up then exit
  stop();
  await Deno.remove(tmpDir, { recursive: true });
  Deno.exit(0);
}
