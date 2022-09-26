import util from "../shared/util.ts";
import type { TransformCSSOptions } from "./deps.ts";
import {
  bold,
  dirname,
  ensureDir,
  esbuild,
  extname,
  fromFileUrl,
  green,
  join,
  stopEsbuild,
  transformCSS,
} from "./deps.ts";
import depGraph from "./graph.ts";
import {
  builtinModuleExts,
  existsDir,
  existsFile,
  fetchCode,
  getAlephPkgUri,
  globalIt,
  isNpmPkg,
  restoreUrl,
  toLocalPath,
} from "./helpers.ts";
import { parseHtmlLinks } from "./html.ts";
import log from "./log.ts";
import { initRouter } from "./routing.ts";
import type { AlephConfig, ConnInfo } from "./types.ts";

export async function optimize(
  serverHandler: (req: Request, connInfo: ConnInfo) => Promise<Response>,
  config: AlephConfig,
  appDir?: string,
) {
  const start = performance.now();
  const alephPkgUri = getAlephPkgUri();
  const options = config?.optimization ?? {};
  const target = options.buildTarget ?? "es2018";
  const outputDir = join(appDir ?? Deno.cwd(), options.outputDir ?? "./output");

  const request = (url: URL, headers?: HeadersInit) => {
    const addr: Deno.Addr = { transport: "tcp", hostname: "localhost", port: 80 };
    return serverHandler(new Request(url, { headers }), { localAddr: addr, remoteAddr: addr });
  };

  // clean previous build
  if (await existsDir(outputDir)) {
    for await (const entry of Deno.readDir(outputDir)) {
      await Deno.remove(join(outputDir, entry.name), { recursive: entry.isDirectory });
    }
  } else {
    await Deno.mkdir(outputDir, { recursive: true });
  }

  // find route files by the `routes` config
  const routeFiles: string[] = [];
  const ssgOptions = options.ssg === true ? {} : options.ssg ?? false;
  const ssgPaths: string[] = [];
  if (config?.router) {
    const { routes } = await globalIt(
      "__ALEPH_ROUTER",
      () => initRouter(config.router!, appDir),
    );
    routes.forEach(([_, { filename }]) => {
      routeFiles.push(filename);
    });
    if (ssgOptions && config.ssr) {
      for (const [_, { pattern }] of routes) {
        const { pathname } = pattern;
        if (pathname.includes("/:")) {
          const url = new URL("http://localhost/aleph.getStaticPaths");
          url.searchParams.set("pattern", pathname);
          const res = await request(url);
          if (res.status === 200 && res.headers.get("content-type")?.startsWith("application/json")) {
            const a = await res.json();
            if (Array.isArray(a)) {
              ssgPaths.push(...a);
            }
          }
        } else if (pathname !== "/_app") {
          ssgPaths.push(pathname);
        }
      }
    }
  }

  if (ssgOptions && config.ssr) {
    if (typeof ssgOptions.getStaticPaths === "function") {
      ssgPaths.push(...await ssgOptions.getStaticPaths());
    }
    const finalPaths = ssgPaths.filter((pathname) => {
      if (ssgOptions?.include) {
        return ssgOptions.include.test(pathname);
      }
      if (ssgOptions?.exclude) {
        return !ssgOptions.exclude.test(pathname);
      }
      return true;
    });
    await Promise.all(finalPaths.map(async (pathname) => {
      const url = new URL(pathname, "http://localhost");
      const res = await request(url, ssgOptions?.clientHeaders);
      if (
        (res.status === 200 || (res.status === 404 && pathname === "/_404")) &&
        res.headers.get("content-type")?.startsWith("text/html")
      ) {
        const savePath = join(outputDir, `${pathname === "/" ? "/index" : pathname}.html`);
        const html = await res.text();
        await ensureDir(dirname(savePath));
        await Deno.writeTextFile(savePath, html);
      }
    }));
    console.log(`${green("SSG")} ${bold(finalPaths.length.toString())} page generated.`);
    console.log(
      finalPaths.map((pathname, index) => {
        const tab = index === finalPaths.length - 1 ? "└─" : "├─";
        return `${tab} ${pathname}`;
      }).join("\n"),
    );
  }

  // look up client modules
  let queue = [...routeFiles];
  const indexHtml = join(appDir ?? Deno.cwd(), "index.html");
  if (await existsFile(indexHtml)) {
    const html = await Deno.readFile(indexHtml);
    const links = await parseHtmlLinks(html);
    for (const src of links) {
      const url = new URL(src, "http://localhost/");
      const ext = extname(url.pathname).slice(1);
      if (ext === "css" || builtinModuleExts.includes(ext)) {
        const specifier = util.isLikelyHttpURL(src) ? src : "." + util.cleanPath(src);
        queue.push(specifier);
      }
    }
  }
  queue.push(`${alephPkgUri}/runtime/core/nomodule.ts`);

  // add unocss reset css
  if (config.unocss) {
    queue.push(`https://esm.sh/@unocss/reset@0.45.14/${config.unocss.resetCSS ?? "tailwind"}.css`);
  }

  const entryModules = new Map(queue.map((task) => [task, 0]));
  const allClientModules = new Set<string>();
  const memFS = new Map<string, string>();

  // transform client modules
  while (queue.length > 0) {
    const deps = new Set<string>();
    await Promise.all(queue.map(async (specifier) => {
      const url = new URL(util.isLikelyHttpURL(specifier) ? toLocalPath(specifier) : specifier, "http://localhost");
      const isCSS = url.pathname.endsWith(".css");
      let savePath = join(outputDir, url.pathname);
      if (isNpmPkg(specifier)) {
        savePath += ".js";
      } else if (isCSS && url.searchParams.has("module")) {
        savePath += ".js";
      }
      const res = await request(url);
      if (
        res.status !== 200 ||
        res.headers.get("Content-Type")?.startsWith("text/html") ||
        res.headers.has("X-Transform-Error")
      ) {
        throw new Error("Transform Error");
      }
      memFS.set(savePath, await res.text());
      if (!isCSS) {
        depGraph?.get(specifier)?.deps?.forEach(({ specifier, dynamic }) => {
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
        deps.add(`${alephPkgUri}/runtime/core/style.ts`);
      } else {
        await ensureDir(dirname(savePath));
        await Deno.writeTextFile(savePath, memFS.get(savePath)!);
      }
      allClientModules.add(specifier);
    }));
    queue = Array.from(deps).filter((specifier) => !allClientModules.has(specifier));
  }

  const clientModules = new Map(entryModules);
  const refs = new Map<string, Set<string>>();

  // count client module refs
  for (const [name] of entryModules) {
    depGraph?.walk(name, ({ specifier }, importer) => {
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

  // hygiene checks, make sure all shared modules are not only referenced by other shared modules
  for (let i = 0; i < 100; i++) {
    const toHygiene = new Set<string>();
    for (const [specifier, type] of clientModules) {
      if (type === 2) {
        const sharedBy = new Set<string>();
        depGraph?.lookup(specifier, (specifier) => {
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
      if (isNpmPkg(entryPoint)) {
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
        minify: true,
        treeShaking: true,
        sourcemap: false,
        plugins: [{
          name: "bundle-client-modules",
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
              if (isNpmPkg(specifier)) {
                jsFile += ".js";
              } else if (specifier.endsWith(".css") && new URLSearchParams(q).has("module")) {
                jsFile += ".js";
              }
              return { path: jsFile };
            });
            build.onLoad({ filter: /.*/ }, (args) => {
              return {
                contents: memFS.get(args.path),
                loader: "js",
              };
            });
          },
        }],
      });
    }),
  );

  stopEsbuild();
  memFS.clear();

  log.info(`${bold(routeFiles.length.toString())} routes found`);
  log.info(`${bold(clientModules.size.toString())} client modules built`);
  log.info(`Done in ${(performance.now() - start).toFixed(2)}ms`);
  Deno.exit(0);
}

/** Bundle the css using `parcel-css` with `nesting` and `customMedia` draft support. */
export async function bundleCSS(
  specifier: string,
  sourceCode: string,
  options: {
    asJsModule?: boolean;
    hmr?: boolean;
  } & TransformCSSOptions,
  _tracing = new Set<string>(),
): Promise<{
  code: string;
  cssModulesExports?: Record<string, string>;
  deps?: string[];
}> {
  let { code: css, dependencies, exports } = await transformCSS(
    specifier,
    sourceCode,
    {
      ...options,
      analyzeDependencies: true,
      drafts: {
        nesting: true,
        customMedia: true,
      },
    },
  );
  const deps = dependencies?.filter((dep) => dep.type === "import" && !dep.media).map((dep) => {
    let url = dep.url;
    if (util.isLikelyHttpURL(specifier)) {
      if (!util.isLikelyHttpURL(url)) {
        url = new URL(url, specifier).toString();
      }
    } else {
      url = "." + fromFileUrl(new URL(url, `file://${specifier.slice(1)}`));
    }
    return url;
  });
  dependencies?.forEach((dep) => {
    if (dep.type === "url") {
      // todo: use magic-string
      css = css.replace(`url("${dep.placeholder}")`, `url("${dep.url}")`);
    }
  });
  const eof = options.minify ? "" : "\n";
  if (deps) {
    const imports = await Promise.all(deps.map(async (url) => {
      if (_tracing.has(url)) {
        return "";
      }
      _tracing.add(url);
      const [css] = await fetchCode(url);
      const { code, deps: subDeps } = await bundleCSS(
        url,
        css,
        {
          targets: options.targets,
          minify: options.minify,
        },
        _tracing,
      );
      if (subDeps) {
        deps.push(...subDeps);
      }
      return code;
    }));
    css = imports.join(eof) + eof + css;
  }
  const cssModulesExports: Record<string, string> = {};
  if (exports) {
    for (const [key, value] of Object.entries(exports)) {
      cssModulesExports[key] = value.name;
    }
  }
  if (options.asJsModule) {
    const alephPkgPath = toLocalPath(getAlephPkgUri());
    return {
      code: [
        options.hmr &&
        `import createHotContext from "${alephPkgPath}/runtime/core/hmr.ts";`,
        options.hmr &&
        `import.meta.hot = createHotContext(${JSON.stringify(specifier)});`,
        `import { applyCSS } from "${alephPkgPath}/runtime/core/style.ts";`,
        `export const css = ${JSON.stringify(css)};`,
        `export default ${JSON.stringify(cssModulesExports)};`,
        `applyCSS(${JSON.stringify(specifier)}, css);`,
        options.hmr && `import.meta.hot.accept();`,
      ].filter(Boolean).join(eof),
      deps,
      cssModulesExports,
    };
  }
  return { code: css, cssModulesExports, deps };
}
