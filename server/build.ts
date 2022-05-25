import { basename, dirname, extname, join } from "https://deno.land/std@0.136.0/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.136.0/fs/ensure_dir.ts";
import { build as esbuild, type Loader, stop } from "https://deno.land/x/esbuild@v0.14.38/mod.js";
import { parseExportNames } from "https://deno.land/x/aleph_compiler@0.5.5/mod.ts";
import { existsDir, existsFile } from "../lib/fs.ts";
import { parseHtmlLinks } from "./html.ts";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import type { DependencyGraph } from "./graph.ts";
import {
  builtinModuleExts,
  getAlephPkgUri,
  initModuleLoaders,
  loadImportMap,
  loadJSXConfig,
  restoreUrl,
  toLocalPath,
} from "./helpers.ts";
import { initRoutes } from "./routing.ts";
import type { AlephConfig, BuildPlatform } from "./types.ts";

const supportedPlatforms: Record<BuildPlatform, string> = {
  "deno": "Deno",
  "cloudflare": "Cloudflare",
  "vercel": "Vercel",
};

/**
 * Build the app into a worker for serverless platform. Functions include:
 * - import routes modules (since deno-deploy/cloudflare don't support dynamic import)
 * - apply module loaders
 * - pre-compile/bundle client modules
 * - resolve import maps
 *
 * after build, you need to bootstrap the server from `./dist/server.js`
 */
export async function build(serverEntry?: string) {
  const workingDir = Deno.cwd();
  const alephPkgUri = getAlephPkgUri();
  const importMap = await loadImportMap();
  const jsxCofig = await loadJSXConfig(importMap);
  const moduleLoaders = await initModuleLoaders(importMap);
  const config: AlephConfig | undefined = Reflect.get(globalThis, "__ALEPH_CONFIG");
  const platform = config?.build?.platform ?? "deno";
  const target = config?.build?.target ?? "es2020";
  const outputDir = join(workingDir, config?.build?.outputDir ?? "dist");
  const modulesProxyPort = Deno.env.get("ALEPH_MODULES_PROXY_PORT");

  if (platform === "cloudflare" || platform === "vercel") {
    log.fatal(`Deploy to ${supportedPlatforms[platform]} is not supported yet`);
  }

  // clean previous build
  if (await existsDir(outputDir)) {
    for await (const entry of Deno.readDir(outputDir)) {
      await Deno.remove(join(outputDir, entry.name), { recursive: entry.isDirectory });
    }
  } else {
    await Deno.mkdir(outputDir, { recursive: true });
  }

  // find route files by the `routes` config
  let routeFiles: [filename: string, exportNames: string[]][] = [];
  if (config?.routes) {
    const { routes } = await initRoutes(config?.routes);
    routeFiles = await Promise.all(routes.map(async ([_, { filename }]) => {
      let code: string;
      let lang: "ts" | "tsx" | "js" | "jsx" | undefined = undefined;
      const ext = extname(filename).slice(1);
      if (builtinModuleExts.includes(ext)) {
        code = await Deno.readTextFile(filename);
      } else if (modulesProxyPort) {
        const res = await fetch(`http://localhost:${modulesProxyPort}/${filename.slice(1)}`);
        const v = res.headers.get("X-Language");
        code = await res.text();
        lang = v === "ts" || v === "tsx" || v === "js" || v === "jsx" ? v : undefined;
      } else {
        throw new Error(`Unsupported module type: ${ext}`);
      }
      const exportNames = await parseExportNames(filename, code, { lang });
      return [filename, exportNames];
    }));
  }

  const serverEntryCode = [
    `import { DependencyGraph } from "${alephPkgUri}/server/graph.ts";`,
    `import graph from "./server_dependency_graph.js";`,
    `globalThis.serverDependencyGraph = new DependencyGraph(graph.modules);`,
    routeFiles.length > 0 && `import { revive } from "${alephPkgUri}/server/routing.ts";`,
    moduleLoaders.length > 0 &&
    `import { globToRegExp } from "https://deno.land/std@0.136.0/path/mod.ts";const moduleLoaders = []; globalThis["__ALEPH_MODULE_LOADERS"] = moduleLoaders;`,
    moduleLoaders.length > 0 &&
    moduleLoaders.map((loader) => {
      const meta = Reflect.get(loader, "meta");
      return `
        {
          const reg = globToRegExp(${JSON.stringify(meta.glob)});
          moduleLoaders.push({
            meta: ${JSON.stringify(meta)},
            test: (pathname) => reg.test(pathname),
            load: (pathname, env) => ({ code: '' }),
          })
        }
      `;
    }).join("\n"),
    ...routeFiles.map(([filename, exportNames], idx) => {
      if (exportNames.length === 0) {
        return [];
      }
      const url = `http://localhost:${modulesProxyPort}${filename.slice(1)}`;
      return [
        `import { ${exportNames.map((name, i) => `${name} as ${"$".repeat(i + 1)}${idx}`).join(", ")} } from ${
          JSON.stringify(url)
        };`,
        `revive(${JSON.stringify(filename)}, { ${
          exportNames.map((name, i) => `${name}: ${"$".repeat(i + 1)}${idx}`).join(", ")
        } });`,
      ];
    }),
    serverEntry && `import "http://localhost:${modulesProxyPort}/${basename(serverEntry)}";`,
    !serverEntry && `import { serve } from "${alephPkgUri}/server/mode.ts";`,
    !serverEntry && `serve();`,
  ].flat().filter(Boolean).join("\n");

  // since esbuild doesn't support jsx automic transform, we need to manually import jsx runtime
  let jsxShimFile: string | null = null;
  if (serverEntry && util.endsWithAny(serverEntry, ".jsx", ".tsx") && jsxCofig.jsxImportSource) {
    jsxShimFile = join(outputDir, "jsx-shim.js");
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

  const shouldBundle = (importUrl: string) => {
    return (
      // to bundle `server/transformer.ts`, need to bundle `server/mod.ts` first
      importUrl === alephPkgUri + "/server/mod.ts" ||
      // bundle `server/transformer.ts` with `server/server_dist.ts` content
      importUrl === alephPkgUri + "/server/transformer.ts" ||
      // since deno deploy doesn't support importMap, we need to bundle the framework and resolve the 'react' import
      importUrl.startsWith(alephPkgUri + "/framework/react/") ||
      importUrl.startsWith(alephPkgUri + "/framework/vue/") ||
      // bundle app modules
      importUrl.startsWith(`http://localhost:${modulesProxyPort}/`)
    );
  };

  // check if the url is esm.sh package
  const isEsmPkg = (url: string) => {
    return url.startsWith("https://esm.sh/") && !url.endsWith(".js") && !url.endsWith(".css");
  };

  // build the server entry
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
    minify: !Deno.env.get("ALEPH_BUILD_DEBUG"),
    treeShaking: true,
    sourcemap: true,
    jsxFactory: jsxCofig.jsxRuntime === "preact" ? "h" : "React.createElement",
    jsxFragment: jsxCofig.jsxRuntime === "preact" ? "Fragment" : "React.Fragment",
    inject: [jsxShimFile as string].filter(Boolean),
    plugins: [{
      name: "aleph-esbuild-plugin",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          let importUrl = args.path;
          if (importUrl in importMap.imports) {
            // since deno deploy doesn't support importMap yet, we need to resolve the 'react' import
            importUrl = importMap.imports[importUrl];
          }

          const isRemote = util.isLikelyHttpURL(importUrl);
          const [path] = util.splitBy(isRemote ? importUrl : util.trimPrefix(importUrl, "file://"), "#");

          if (args.kind === "dynamic-import") {
            return { path, external: true };
          }

          if (args.namespace === "http") {
            const { href } = new URL(path, args.importer);
            if (!shouldBundle(href)) {
              return { path: href, external: true };
            }
            return { path: href, namespace: "http" };
          }

          if (isRemote && shouldBundle(path)) {
            return { path, namespace: "http" };
          }

          if (isRemote || path === "./server_dependency_graph.js") {
            return { path, external: true };
          }

          if (path.startsWith("./") || path.startsWith("../")) {
            return {
              path: join(dirname(args.importer), path),
            };
          }

          return { path };
        });
        build.onLoad({ filter: /.*/, namespace: "http" }, async (args) => {
          const url = new URL(args.path);
          if (url.href === `${alephPkgUri}/server/transformer.ts`) {
            // bundle `server/transformer.ts` with `server/server_dist.ts` content
            url.pathname = util.trimSuffix(url.pathname, "transformer.ts") + "serve_dist.ts";
          }
          const res = await fetch(url.href);
          const contents = await res.text();
          let ext = extname(url.pathname).slice(1);
          if (ext === "mjs") {
            ext = "js";
          } else if (ext === "mts") {
            ext = "ts";
          } else if (!builtinModuleExts.includes(ext)) {
            const ctype = res.headers.get("Content-Type");
            if (ctype?.startsWith("application/javascript")) {
              ext = "js";
            } else if (ctype?.startsWith("application/typescript")) {
              ext = "ts";
            } else if (ctype?.startsWith("text/jsx")) {
              ext = "jsx";
            } else if (ctype?.startsWith("text/tsx")) {
              ext = "tsx";
            }
          }
          return {
            contents,
            loader: ext as unknown as Loader,
          };
        });
      },
    }],
  });

  // get depndency graph
  const serverDependencyGraph: DependencyGraph | undefined = Reflect.get(globalThis, "__ALEPH_SERVER_DEP_GRAPH");
  const clientDependencyGraph: DependencyGraph | undefined = Reflect.get(globalThis, "__ALEPH_CLIENT_DEP_GRAPH");

  // create server_dependency_graph.js
  if (serverDependencyGraph) {
    const { modules } = serverDependencyGraph;
    await Deno.writeTextFile(
      join(outputDir, "server_dependency_graph.js"),
      "export default " + JSON.stringify({ modules }),
    );
  }

  // look up client modules
  let tasks = routeFiles.map(([filename]) => filename);
  if (await existsFile(join(workingDir, "index.html"))) {
    const html = await Deno.readFile(join(workingDir, "index.html"));
    const links = await parseHtmlLinks(html);
    for (const src of links) {
      const url = new URL(src, "http://localhost/");
      const ext = extname(url.pathname).slice(1);
      if (ext === "css" || builtinModuleExts.includes(ext)) {
        const specifier = util.isLikelyHttpURL(src) ? src : "." + util.cleanPath(src);
        tasks.push(specifier);
      }
    }
  }
  tasks.push(`${alephPkgUri}/framework/core/nomodule.ts`);

  const entryModules = new Map(tasks.map((task) => [task, 0]));
  const allClientModules = new Set<string>();

  // transform client modules
  const serverHandler: ((req: Request) => Promise<Response>) | undefined = Reflect.get(globalThis, "__ALEPH_SERVER")
    ?.handler;
  if (serverHandler) {
    while (tasks.length > 0) {
      const deps = new Set<string>();
      await Promise.all(tasks.map(async (specifier) => {
        const url = new URL(util.isLikelyHttpURL(specifier) ? toLocalPath(specifier) : specifier, "http://localhost");
        const isCSS = url.pathname.endsWith(".css");
        const req = new Request(url.toString());
        let savePath = join(outputDir, url.pathname);
        if (isEsmPkg(specifier)) {
          savePath += ".js";
        } else if (isCSS && url.searchParams.has("module")) {
          savePath += ".js";
        }
        await ensureDir(dirname(savePath));
        const [res, file] = await Promise.all([
          serverHandler(req),
          Deno.open(savePath, { write: true, create: true }),
        ]);
        await res.body?.pipeTo(file.writable);
        if (!isCSS) {
          clientDependencyGraph?.get(specifier)?.deps?.forEach(({ specifier, dynamic }) => {
            if (dynamic) {
              entryModules.set(specifier, 1);
            }
            if (specifier.endsWith(".css")) {
              deps.add(specifier + "?module");
            } else {
              deps.add(specifier);
            }
          });
        } else if (url.searchParams.has("module")) {
          deps.add(`${alephPkgUri}/framework/core/style.ts`);
        }
        allClientModules.add(specifier);
      }));
      tasks = Array.from(deps).filter((specifier) => !allClientModules.has(specifier));
    }
  }

  const clientModules = new Map(entryModules);
  const refs = new Map<string, Set<string>>();

  // count client module refs
  for (const [name] of entryModules) {
    clientDependencyGraph?.walk(name, ({ specifier }, importer) => {
      if (importer) {
        let set = refs.get(specifier);
        if (!set) {
          set = new Set<string>();
          refs.set(specifier, set);
        }
        set.add(importer.specifier);
      }
    });
  }

  // find shared modules
  for (const [specifier, counter] of refs) {
    if (counter.size > 1) {
      clientModules.set(specifier, 2);
    }
  }

  // hygiene check, make sure all shared modules are not only referenced by other shared modules
  for (let i = 0; i < 100; i++) {
    const toHygiene = new Set<string>();
    for (const [specifier, type] of clientModules) {
      if (type === 2) {
        const sharedBy = new Set<string>();
        clientDependencyGraph?.lookup(specifier, (specifier) => {
          if (clientModules.has(specifier)) {
            sharedBy.add(specifier);
            return false;
          }
        });
        if (sharedBy.size === 1) {
          toHygiene.add(specifier);
        }
      }
    }
    // break the loop when there are no more modules to hygiene
    if (toHygiene.size === 0) {
      break;
    }
    toHygiene.forEach((specifier) => clientModules.delete(specifier));
    log.debug(`hygiene#${i + 1}`, toHygiene);
  }

  // bundle client modules
  await Promise.all(
    Array.from(clientModules.keys()).map(async (entryPoint) => {
      const url = new URL(util.isLikelyHttpURL(entryPoint) ? toLocalPath(entryPoint) : entryPoint, "http://localhost");
      if (url.pathname.endsWith(".css")) {
        return;
      }
      let jsFile = join(outputDir, url.pathname);
      if (isEsmPkg(entryPoint)) {
        jsFile += ".js";
      }
      await esbuild({
        entryPoints: [jsFile],
        outfile: jsFile,
        allowOverwrite: true,
        platform: "browser",
        format: "esm",
        target: [target],
        bundle: true,
        minify: !Deno.env.get("ALEPH_BUILD_DEBUG"),
        treeShaking: true,
        sourcemap: false,
        loader: {
          ".vue": "js",
        },
        plugins: [{
          name: "aleph-esbuild-plugin",
          setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
              let argsPath = args.path;
              if (argsPath.startsWith("./") || argsPath.startsWith("../")) {
                argsPath = join(args.resolveDir, argsPath);
              }
              const [fp, q] = util.splitBy(argsPath, "?");
              const path = util.trimPrefix(fp, outputDir);
              let specifier = "." + path;
              if (args.path.startsWith("/-/")) {
                specifier = restoreUrl(path);
              }
              if (clientModules.has(specifier) && specifier !== entryPoint) {
                return {
                  path: [path, q].filter(Boolean).join("?"),
                  external: true,
                };
              }
              let jsFile = join(outputDir, path);
              if (isEsmPkg(specifier)) {
                jsFile += ".js";
              } else if (specifier.endsWith(".css") && new URLSearchParams(q).has("module")) {
                jsFile += ".js";
              }
              return { path: jsFile };
            });
          },
        }],
      });
    }),
  );

  // clean up then exit
  // todo: remove dead client modules
  if (jsxShimFile) {
    await Deno.remove(jsxShimFile);
  }
  stop();

  return { clientModules, routeFiles };
}
