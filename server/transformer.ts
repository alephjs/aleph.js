import { createGenerator } from "https://esm.sh/@unocss/core@0.24.4";
import { transform, transformCSS } from "../compiler/mod.ts";
import { restoreUrl, toLocalPath } from "../lib/path.ts";
import { Loader, serveDir } from "../lib/serve.ts";
import util from "../lib/util.ts";
import type { AtomicCSSConfig, JSXConfig } from "../types.d.ts";
import { VERSION } from "../version.ts";
import { getAlephPkgUri, loadImportMap, loadJSXConfig } from "./config.ts";
import { isRouteFile } from "./routing.ts";
import { DependencyGraph } from "./graph.ts";

export const clientDependencyGraph = new DependencyGraph();
export const serverDependencyGraph = new DependencyGraph();

const enc = new TextEncoder();
const dec = new TextDecoder();

const cssModuleLoader: Loader = {
  test: (url) => url.pathname.endsWith(".css"),
  load: async ({ pathname }, rawContent) => {
    const specifier = "." + util.trimPrefix(pathname, Deno.cwd());
    const { code } = await bundleCSS(specifier, dec.decode(rawContent), {
      minify: Deno.env.get("ALEPH_ENV") !== "development",
      cssModules: pathname.endsWith(".module.css"),
      toJS: true,
    });
    return {
      content: enc.encode(code),
      contentType: "application/javascript; charset=utf-8",
    };
  },
};

export async function serveAppModules(port: number) {
  try {
    Deno.env.set("ALEPH_APP_MODULES_PORT", port.toString());
    await serveDir({ cwd: "/", port, loaders: [cssModuleLoader] });
  } catch (error) {
    if (error instanceof Deno.errors.AddrInUse) {
      await serveAppModules(port + 1);
    } else {
      throw error;
    }
  }
}

type TransformeOptions = {
  atomicCSS?: AtomicCSSConfig;
  isDev: boolean;
};

export const clientModuleTransformer = {
  fetch: async (req: Request, options: TransformeOptions): Promise<Response> => {
    const { pathname, searchParams, search } = new URL(req.url);
    const { isDev, atomicCSS } = options;
    const specifier = pathname.startsWith("/-/") ? restoreUrl(pathname + search) : `.${pathname}`;
    const isJSX = pathname.endsWith(".jsx") || pathname.endsWith(".tsx");
    const jsxConfig: JSXConfig = isJSX ? await loadJSXConfig() : {};
    const [rawCode, mtime] = await readCode(specifier);
    const buildArgs = VERSION + JSON.stringify(jsxConfig) + JSON.stringify(atomicCSS) + isDev;
    const etag = mtime
      ? `${mtime.toString(16)}-${rawCode.length.toString(16)}-${(await computeHash(buildArgs)).slice(0, 8)}`
      : await computeHash(rawCode + buildArgs);
    if (req.headers.get("If-None-Match") === etag) {
      return new Response(null, { status: 304 });
    }

    let resBody = "";
    let resType = "application/javascript";

    if (pathname.endsWith(".css")) {
      const toJS = searchParams.has("module");
      const { code, deps } = await bundleCSS(specifier, rawCode, {
        minify: !isDev,
        cssModules: toJS && pathname.endsWith(".module.css"),
        resolveAlephPkgUri: true,
        hmr: isDev,
        toJS,
      });
      resBody = code;
      if (!toJS) {
        resType = "text/css";
      }
      clientDependencyGraph.mark({
        specifier,
        version: 0,
        deps: deps?.map((specifier) => ({ specifier })),
      });
    } else {
      const importMap = await loadImportMap();
      const graphVersions = clientDependencyGraph.modules.filter((mod) =>
        !util.isLikelyHttpURL(specifier) && !util.isLikelyHttpURL(mod.specifier) && mod.specifier !== specifier
      ).reduce((acc, { specifier, version }) => {
        acc[specifier] = version.toString(16);
        return acc;
      }, {} as Record<string, string>);
      const useUnocss = Boolean(atomicCSS?.presets?.length) && isJSX;
      const alephPkgUri = getAlephPkgUri();
      const { code, jsxStaticClasses, deps } = await transform(specifier, rawCode, {
        ...jsxConfig,
        alephPkgUri,
        stripDataExport: isRouteFile(specifier),
        parseJsxStaticClasses: useUnocss,
        graphVersions,
        importMap,
        isDev,
      });
      const atomicStyle = new Set(jsxStaticClasses?.map((name) => name.split(" ").map((name) => name.trim())).flat());
      let inlineCSS: string | null = null;
      if (useUnocss && atomicStyle.size > 0) {
        const uno = createGenerator(atomicCSS);
        const { css } = await uno.generate(atomicStyle, { id: specifier, minify: !isDev });
        inlineCSS = css;
      }
      resBody = code + (inlineCSS
        ? `\nimport { applyCSS } from "${toLocalPath(alephPkgUri)}framework/core/style.ts";` +
          `\napplyCSS(${JSON.stringify(specifier)}, { css: ${JSON.stringify(inlineCSS)} });`
        : "");
      clientDependencyGraph.mark({ specifier, version: 0, deps, inlineCSS: Boolean(inlineCSS) });
    }
    return new Response(resBody, {
      headers: {
        "Content-Type": `${resType}; charset=utf-8`,
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Etag": etag,
      },
    });
  },
};

type BundleCssOptions = {
  cssModules?: boolean;
  minify?: boolean;
  resolveAlephPkgUri?: boolean;
  hmr?: boolean;
  toJS?: boolean;
};

export async function bundleCSS(
  specifier: string,
  rawCode: string,
  options: BundleCssOptions,
  tracing = new Set<string>(),
): Promise<{ code: string; deps?: string[] }> {
  const eof = options.minify ? "" : "\n";
  let { code: css, dependencies, exports } = await transformCSS(specifier, rawCode, {
    ...options,
    analyzeDependencies: true,
    drafts: {
      nesting: true,
      customMedia: true,
    },
  });
  const deps = dependencies?.filter((dep) => dep.type === "import").map((dep) => {
    let url = dep.url;
    if (util.isLikelyHttpURL(specifier)) {
      if (!util.isLikelyHttpURL(url)) {
        url = new URL(url, specifier).toString();
      }
    } else {
      url = "." + new URL(url, `http://-${specifier.slice(1)}`).pathname;
    }
    return url;
  });
  if (deps) {
    const imports = await Promise.all(deps.map(async (url) => {
      if (tracing.has(url)) {
        return "";
      }
      tracing.add(url);
      const [css] = await readCode(url);
      const { code } = await bundleCSS(url, css, { minify: options.minify }, tracing);
      return code;
    }));
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
    return {
      code: [
        options.hmr && `import createHotContext from "${toLocalPath(alephPkgUri)}framework/core/hmr.ts";`,
        options.hmr && `import.meta.hot = createHotContext(${JSON.stringify(specifier)});`,
        `import { applyCSS } from "${
          options.resolveAlephPkgUri ? toLocalPath(alephPkgUri).slice(0, -1) : alephPkgUri
        }/framework/core/style.ts";`,
        `export const css = ${JSON.stringify(css)};`,
        `export default ${JSON.stringify(cssModulesExports)};`,
        `applyCSS(${JSON.stringify(specifier)}, { css });`,
        options.hmr && `import.meta.hot.accept();`,
      ].filter(Boolean).join(eof),
      deps,
    };
  }
  return { code: css, deps };
}

async function readCode(filename: string): Promise<[string, number | undefined]> {
  if (util.isLikelyHttpURL(filename)) {
    const url = new URL(filename);
    if (url.hostname === "esm.sh") {
      url.searchParams.set("target", "es2021");
    }
    const res = await fetch(url.toString());
    if (res.status >= 400) {
      throw new Error(`fetch ${filename}: ${res.status} - ${res.statusText}`);
    }
    const val = res.headers.get("Last-Modified");
    const mtime = val ? new Date(val).getTime() : undefined;
    return [await res.text(), mtime];
  }
  const stat = await Deno.stat(filename);
  return [await Deno.readTextFile(filename), stat.mtime?.getTime()];
}

async function computeHash(content: string): Promise<string> {
  return util.toHex(await crypto.subtle.digest("sha-1", enc.encode(content)));
}
