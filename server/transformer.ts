import { dirname, join } from "https://deno.land/std@0.125.0/path/mod.ts";
import { transform, transformCSS } from "../compiler/mod.ts";
import { restoreUrl, toLocalPath } from "../lib/path.ts";
import { Loader, serveDir } from "../lib/serve.ts";
import util from "../lib/util.ts";
import { getAlephPkgUri, loadImportMap } from "./config.ts";
import { DependencyGraph } from "./graph.ts";
import type { AlephJSXConfig } from "./types.d.ts";

export const clientDependencyGraph = new DependencyGraph();
export const serverDependencyGraph = new DependencyGraph();

const enc = new TextEncoder();
const dec = new TextDecoder();

const cssModuleLoader: Loader = {
  test: (url) => url.split("?").shift()!.endsWith(".css"),
  load: async (url, rawContent) => {
    const { pathname } = new URL(url);
    const specifier = "." + util.trimPrefix(pathname, Deno.cwd());
    const js = await bundleCSS(specifier, dec.decode(rawContent), {
      minify: Deno.env.get("ALEPH_ENV") !== "development",
      cssModules: pathname.endsWith(".module.css"),
      toJS: true,
    });
    return {
      content: enc.encode(js),
      contentType: "application/javascript; charset=utf-8",
    };
  },
};

export async function serveAppModules(port: number) {
  Deno.env.set("ALEPH_APP_MODULES_PORT", port.toString());
  await serveDir({ cwd: "/", port, loaders: [cssModuleLoader] });
}

type Options = {
  jsxConfig: AlephJSXConfig;
  isDev: boolean;
  mtime?: Date;
};

export const fetchClientModule = async (pathname: string, { jsxConfig, isDev, mtime }: Options): Promise<Response> => {
  const [specifier, rawCode] = await readCode(pathname);
  let js: string;
  if (pathname.endsWith(".css")) {
    js = await bundleCSS(specifier, rawCode, {
      minify: !isDev,
      cssModules: pathname.endsWith(".module.css"),
      toJS: true,
      resolveAlephPkgUri: true,
    });
  } else {
    const importMap = await loadImportMap();
    const graphVersions = clientDependencyGraph.modules.filter((mod) =>
      !util.isLikelyHttpURL(specifier) && !util.isLikelyHttpURL(mod.specifier) && mod.specifier !== specifier
    ).reduce((acc, { specifier, version }) => {
      acc[specifier] = version;
      return acc;
    }, {} as Record<string, number>);
    const ret = await transform(specifier, rawCode, {
      ...jsxConfig,
      alephPkgUri: getAlephPkgUri(),
      graphVersions,
      importMap,
      isDev,
    });
    if (!clientDependencyGraph.has(specifier)) {
      clientDependencyGraph.add({
        specifier,
        version: 0,
        deps: ret.deps || [],
      });
    }
    js = ret.code;
  }
  const headers = new Headers({ "Content-Type": "application/javascript; charset=utf-8" });
  if (mtime) {
    headers.set("Last-Modified", mtime.toUTCString());
  }
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  return new Response(js, { headers });
};

export async function bundleCSS(
  specifier: string,
  rawCode: string,
  options: {
    cssModules?: boolean;
    minify?: boolean;
    toJS?: boolean;
    resolveAlephPkgUri?: boolean;
  },
  tracing = new Set<string>(),
): Promise<string> {
  const eof = options.minify ? "" : "\n";
  let { code: css, dependencies, exports } = await transformCSS(specifier, rawCode, {
    ...options,
    analyzeDependencies: true,
    drafts: {
      nesting: true,
      customMedia: true,
    },
  });
  if (dependencies && dependencies.length > 0) {
    const imports = await Promise.all(
      dependencies.filter((dep) => dep.type === "import").map(async (dep) => {
        const pathname = util.isLikelyHttpURL(specifier) ? toLocalPath(specifier) : specifier;
        const p = join(dirname(pathname), dep.url);
        if (tracing.has(p)) {
          return "";
        }
        tracing.add(p);
        const [s, css] = await readCode(p);
        return await bundleCSS(s, css, { minify: options.minify }, tracing);
      }),
    );
    css = imports.join(eof) + eof + css;
  }
  if (options.toJS) {
    const alephPkgUri = getAlephPkgUri();
    const cssModulesExports: Record<string, string> = {};
    if (exports) {
      for (const [key, value] of Object.entries(exports)) {
        cssModulesExports[key] = value.name;
      }
    }
    return [
      `import { applyCSS } from "${
        options.resolveAlephPkgUri ? toLocalPath(alephPkgUri).slice(0, -1) : alephPkgUri
      }/framework/core/style.ts";`,
      `export const css = ${JSON.stringify(css)};`,
      `export default ${JSON.stringify(cssModulesExports)};`,
      `applyCSS(${JSON.stringify(specifier)}, { css });`,
    ].join(eof);
  }
  return css;
}

async function readCode(pathname: string): Promise<[string, string]> {
  if (pathname.startsWith("/-/")) {
    const url = restoreUrl(pathname);
    const res = await fetch(url);
    if (res.status >= 400) {
      throw new Error(`fetch ${url}: ${res.status} - ${res.statusText}`);
    }
    return [url, await res.text()];
  }
  if (pathname.startsWith("/")) {
    pathname = `.${pathname}`;
  } else {
    pathname = `./${pathname}`;
  }
  return [pathname, await Deno.readTextFile(pathname)];
}
