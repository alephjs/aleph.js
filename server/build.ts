import { basename, dirname, extname, join } from "https://deno.land/std@0.128.0/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.128.0/fs/ensure_dir.ts";
import { build as esbuild, type Loader, stop } from "https://deno.land/x/esbuild@v0.14.23/mod.js";
import { parseExportNames } from "../compiler/mod.ts";
import cache from "../lib/cache.ts";
import { existsDir, existsFile } from "../lib/fs.ts";
import { builtinModuleExts, toLocalPath } from "../lib/helpers.ts";
import { parseHtmlLinks } from "../lib/html.ts";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import { getAlephPkgUri, loadImportMap, loadJSXConfig } from "../server/config.ts";
import { DependencyGraph } from "../server/graph.ts";
import { initRoutes } from "../server/routing.ts";
import type { AlephConfig, FetchHandler } from "../server/types.ts";

export type BuildPlatform = "deno-deploy" | "cf-worker" | "vercel";

export const supportedPlatforms: Record<BuildPlatform, string> = {
  "deno-deploy": "Deno Deploy",
  "cf-worker": "Cloudflare Worker",
  "vercel": "Vercel",
};

export async function build(
  workingDir: string,
  platform: BuildPlatform,
  serverEntry?: string,
): Promise<{ clientModules: Set<string> }> {
  if (platform === "cf-worker" || platform === "vercel") {
    log.fatal(`Deploy to ${supportedPlatforms[platform]} is not supported yet`);
  }

  const tmpDir = await Deno.makeTempDir();
  const alephPkgUri = getAlephPkgUri();
  const importMap = await loadImportMap();
  const jsxCofig = await loadJSXConfig(importMap);
  const config: AlephConfig | undefined = Reflect.get(globalThis, "__ALEPH_SERVER_CONFIG");
  const outputDir = join(workingDir, config?.build?.outputDir ?? "dist");

  // clean previous build
  if (await existsDir(outputDir)) {
    for await (const entry of Deno.readDir(outputDir)) {
      await Deno.remove(join(outputDir, entry.name), { recursive: entry.isDirectory });
    }
  } else {
    await Deno.mkdir(outputDir, { recursive: true });
  }

  let routeFiles: [filename: string, exportNames: string[]][] = [];
  if (config?.routeFiles) {
    const routes = await initRoutes(config?.routeFiles);
    routeFiles = await Promise.all(routes.map(async ([_, { filename }]) => {
      const code = await Deno.readTextFile(filename);
      const exportNames = await parseExportNames(filename, code);
      return [filename, exportNames];
    }));
  }
  const port = Deno.env.get("ALEPH_APP_MODULES_PORT");
  const serverEntryCode = [
    `import { DependencyGraph } from "${alephPkgUri}/server/graph.ts";`,
    `import graph from "./server_dependency_graph.js";`,
    `globalThis.serverDependencyGraph = new DependencyGraph(graph.modules);`,
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
    serverEntry && `import "http://localhost:${port}/${basename(serverEntry)}";`,
    !serverEntry && `import { serve } from "${alephPkgUri}/server/mode.ts";`,
    !serverEntry && `serve();`,
  ].filter(Boolean).join("\n");

  // since esbuild doesn't support jsx automic transform, we need to manually import jsx runtime
  let jsxShimFile: string | null = null;
  if (serverEntry && util.endsWithAny(serverEntry, ".jsx", ".tsx") && jsxCofig.jsxImportSource) {
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

  const forceBundle = (importUrl: string) => {
    return importUrl === alephPkgUri + "/server/mod.ts" ||
      // since deno deploy doesn't support importMap, we need to resolve the 'react' import
      importUrl.startsWith(alephPkgUri + "/framework/react/") ||
      importUrl.startsWith(`http://localhost:${Deno.env.get("ALEPH_APP_MODULES_PORT")}/`) ||
      importUrl.endsWith(".css");
  };

  // build server entry
  await esbuild({
    stdin: {
      contents: serverEntryCode,
      sourcefile: "server.tsx",
    },
    outfile: join(outputDir, "server.js"),
    platform: "browser",
    format: "esm",
    target: ["esnext"],
    bundle: true,
    minify: !Deno.env.get("ALEPH_DEV_PORT"),
    treeShaking: true,
    sourcemap: true,
    jsxFactory: jsxCofig.jsxRuntime === "preact" ? "h" : "React.createElement",
    jsxFragment: jsxCofig.jsxRuntime === "preact" ? "Fragment" : "React.Fragment",
    inject: [jsxShimFile as string].filter(Boolean),
    plugins: [{
      name: "aleph-server-build-plugin",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          let importUrl = args.path;
          if (importUrl in importMap.imports) {
            importUrl = importMap.imports[importUrl];
          }

          const isRemote = util.isLikelyHttpURL(importUrl);
          const [path] = util.splitBy(isRemote ? importUrl : util.trimPrefix(importUrl, "file://"), "#");

          if (args.kind === "dynamic-import") {
            return { path, external: true };
          }

          if (args.namespace === "http") {
            const { href } = new URL(path, args.importer);
            if (!forceBundle(href)) {
              return { path: href, external: true };
            }
            return { path: href, namespace: "http" };
          }

          if (isRemote && forceBundle(path)) {
            return { path, namespace: "http" };
          }

          if (isRemote || path === "./server_dependency_graph.js") {
            return { path, external: true };
          }

          return { path };
        });
        build.onLoad({ filter: /.*/, namespace: "http" }, async (args) => {
          const url = new URL(args.path);
          if (url.href === `${alephPkgUri}/server/transformer.ts`) {
            url.pathname = util.trimSuffix(url.pathname, "transformer.ts") + "serve_dist.ts";
          }
          const res = await cache(url.href);
          const contents = await res.text();
          const ext = extname(url.pathname).slice(1);
          let loader = ext;
          if (ext === "mjs") {
            loader = "js";
          } else if (ext === "mts") {
            loader = "ts";
          } else if (ext === "pcss" || ext === "postcss") {
            loader = "css";
          }
          const ctype = res.headers.get("Content-Type");
          if (ctype?.startsWith("application/javascript")) {
            loader = "js";
          } else if (ctype?.startsWith("application/typescript")) {
            loader = "ts";
          } else if (ctype?.startsWith("text/jsx")) {
            loader = "jsx";
          } else if (ctype?.startsWith("text/tsx")) {
            loader = "tsx";
          } else if (ctype?.startsWith("text/css")) {
            loader = "css";
          }
          return {
            contents,
            loader: loader as unknown as Loader,
          };
        });
      },
    }],
  });

  // create server_dependency_graph.js
  const serverDependencyGraph: DependencyGraph | undefined = Reflect.get(globalThis, "serverDependencyGraph");
  if (serverDependencyGraph) {
    await Deno.writeTextFile(
      join(outputDir, "server_dependency_graph.js"),
      "export default " + JSON.stringify({ modules: serverDependencyGraph.modules }),
    );
  }

  // look up client modules
  let tasks = routeFiles.map(([filename]) => filename);
  if (await existsFile(join(workingDir, "index.html"))) {
    const html = await Deno.readFile(join(workingDir, "index.html"));
    const links = await parseHtmlLinks(html);
    for (const link of links) {
      if (!util.isLikelyHttpURL(link)) {
        const ext = extname(link);
        if (ext === ".css" || builtinModuleExts.includes(ext.slice(1))) {
          const specifier = "." + util.cleanPath(link);
          tasks.push(specifier);
        }
      }
    }
  }

  // transform client modules
  const serverHandler: FetchHandler | undefined = Reflect.get(globalThis, "__ALEPH_SERVER_HANDLER");
  const clientModules = new Set<string>();
  if (serverHandler) {
    while (tasks.length > 0) {
      const deps = new Set<string>();
      await Promise.all(tasks.map(async (specifier) => {
        const url = new URL(util.isLikelyHttpURL(specifier) ? toLocalPath(specifier) : specifier, "http://localhost");
        const isCSS = url.pathname.endsWith(".css");
        const req = new Request(url.toString());
        const ctx: Record<string, unknown> = {};
        let savePath = join(outputDir, url.pathname);
        if (specifier.startsWith("https://esm.sh/")) {
          savePath += ".js";
        } else if (isCSS && url.searchParams.has("module")) {
          savePath += ".js";
        }
        await ensureDir(dirname(savePath));
        const [res, file] = await Promise.all([
          serverHandler(req, ctx),
          Deno.open(savePath, { write: true, create: true }),
        ]);
        await res.body?.pipeTo(file.writable);
        clientModules.add(specifier);
        if (!isCSS) {
          const clientDependencyGraph: DependencyGraph | undefined = Reflect.get(globalThis, "clientDependencyGraph");
          clientDependencyGraph?.get(specifier)?.deps?.forEach(({ specifier }) => {
            if (specifier.endsWith(".css")) {
              deps.add(specifier + "?module");
            } else {
              deps.add(specifier);
            }
          });
        }
      }));
      tasks = Array.from(deps).filter((specifier) => !clientModules.has(specifier));
    }
  }

  // clean up then exit
  await Deno.remove(tmpDir, { recursive: true });
  stop();

  return { clientModules };
}
