import { basename, extname, join, resolve } from "https://deno.land/std@0.125.0/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.125.0/fs/ensure_dir.ts";
import { build, stop } from "https://deno.land/x/esbuild@v0.14.23/mod.js";
import { parseExportNames } from "../compiler/mod.ts";
import { parse } from "../lib/flags.ts";
import { existsDir, findFile } from "../lib/fs.ts";
import log, { blue } from "../lib/log.ts";
import util from "../lib/util.ts";
import { getAlephPkgUri, loadImportMap, loadJSXConfig } from "../server/config.ts";
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
  const serverEntry = await findFile(Deno.cwd(), ["server.tsx", "server.jsx", "server.ts", "server.js"]);
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
    routeFiles.length && `import { register } from "${alephPkgUri}/server/routing.ts";`,
    ...routeFiles.map(([filename, exportNames], idx) => {
      const hasDefaultExport = exportNames.includes("default");
      const hasDataExport = exportNames.includes("data");
      if (!hasDefaultExport && !hasDataExport) {
        return [];
      }
      return [
        hasDefaultExport && `import default_${idx} from "http://localhost:${port}${filename.slice(1)}";`,
        !hasDefaultExport && `const default_${idx} = undefined;`,
        hasDataExport && `import { data as data_${idx} } from "http://localhost:${port}${filename.slice(1)}";`,
        !hasDataExport && `const data_${idx} = undefined;`,
        `register(${JSON.stringify(filename)}, { default: default_${idx}, data: data_${idx} });`,
      ];
    }).filter(Boolean).flat(),
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
      name: "http-importer",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          const isRemote = util.isLikelyHttpURL(args.path);
          const isLocalUrl = args.path.startsWith(`http://localhost:${Deno.env.get("ALEPH_APP_MODULES_PORT")}/`);
          const [path] = util.splitBy(isRemote ? args.path : util.trimPrefix(args.path, "file://"), "#");

          if (isRemote && !isLocalUrl) {
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
          const contents = await fetch(args.path).then((res) => res.text());
          return {
            contents,
            loader: util.splitBy(extname(args.path).slice(1), "?")[0] as unknown as "js",
          };
        });
      },
    }],
  });

  log.info(`Done in ${(performance.now() - start)}ms`);

  // clean up then exit
  stop();
  await Deno.remove(tmpDir, { recursive: true });
  Deno.exit(0);
}
