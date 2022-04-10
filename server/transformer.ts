import { createGenerator } from "https://esm.sh/@unocss/core@0.30.12";
import MagicString from "https://esm.sh/magic-string@0.26.1";
import { transform } from "../compiler/mod.ts";
import type { TransformOptions } from "../compiler/types.ts";
import { readCode } from "../lib/fs.ts";
import { restoreUrl, toLocalPath } from "../lib/helpers.ts";
import util from "../lib/util.ts";
import { bundleCSS } from "./bundle_css.ts";
import { getAlephPkgUri } from "./config.ts";
import { isRouteFile } from "./routing.ts";
import { DependencyGraph } from "./graph.ts";
import type { AtomicCSSConfig, ImportMap, JSXConfig, ModuleLoaderContent } from "./types.ts";

export type TransformerOptions = {
  atomicCSS?: AtomicCSSConfig;
  buildHash: string;
  buildTarget?: TransformOptions["target"];
  importMap: ImportMap;
  isDev: boolean;
  jsxConfig?: JSXConfig;
  loaded?: ModuleLoaderContent;
};

export default {
  fetch: async (req: Request, options: TransformerOptions): Promise<Response> => {
    const { isDev, buildHash, loaded } = options;
    const { pathname, searchParams, search } = new URL(req.url);
    const specifier = pathname.startsWith("/-/") ? restoreUrl(pathname + search) : `.${pathname}`;
    let rawCode: string;
    let mtime: number | undefined;
    let lang: string | undefined;
    let isCSS: boolean;
    let enableAtomicCSS: boolean;
    if (loaded) {
      rawCode = loaded.code;
      mtime = loaded.modtime;
      lang = loaded.lang;
      isCSS = loaded.lang === "css";
      enableAtomicCSS = !!loaded.atomicCSS;
    } else {
      let ctype: string;
      [rawCode, mtime, ctype] = await readCode(specifier);
      enableAtomicCSS = pathname.endsWith(".jsx") || pathname.endsWith(".tsx");
      isCSS = ctype.startsWith("text/css") || ctype.startsWith("text/postcss");
    }
    const etag = mtime
      ? `${mtime.toString(16)}-${rawCode.length.toString(16)}-${
        rawCode.charCodeAt(Math.floor(rawCode.length / 2)).toString(16)
      }${buildHash.slice(0, 8)}`
      : await util.computeHash("sha-1", rawCode + buildHash);
    if (req.headers.get("If-None-Match") === etag) {
      return new Response(null, { status: 304 });
    }

    let clientDependencyGraph: DependencyGraph;
    if (Reflect.has(globalThis, "clientDependencyGraph")) {
      clientDependencyGraph = Reflect.get(globalThis, "clientDependencyGraph");
    } else {
      clientDependencyGraph = new DependencyGraph();
      Reflect.set(globalThis, "clientDependencyGraph", clientDependencyGraph);
    }

    let resBody = "";
    let resType = "application/javascript";

    if (isCSS) {
      const asJsModule = searchParams.has("module");
      const { code, deps } = await bundleCSS(specifier, rawCode, {
        targets: {
          android: 95,
          chrome: 95,
          edge: 95,
          firefox: 90,
          safari: 14,
        },
        minify: !isDev,
        cssModules: asJsModule && /\.module\.(p|post)?css$/.test(pathname),
        asJsModule,
        hmr: isDev,
      });
      clientDependencyGraph.mark(specifier, { deps: deps?.map((specifier) => ({ specifier })) });
      resBody = code;
      if (!asJsModule) {
        resType = "text/css";
      }
    } else {
      const { atomicCSS, jsxConfig, importMap, buildTarget } = options;
      const alephPkgUri = getAlephPkgUri();
      let { code, deps, map } = await transform(specifier, rawCode, {
        ...jsxConfig,
        lang: lang as TransformOptions["lang"],
        stripDataExport: isRouteFile(specifier),
        target: buildTarget ?? (isDev ? "es2022" : "es2015"),
        alephPkgUri,
        importMap: JSON.stringify(importMap),
        isDev,
      });
      let inlineCSS = loaded?.inlineCSS;
      if (enableAtomicCSS && Boolean(atomicCSS?.presets?.length)) {
        const uno = createGenerator(atomicCSS);
        const { css } = await uno.generate(rawCode, { id: specifier, minify: !isDev });
        if (inlineCSS) {
          inlineCSS = `${inlineCSS}\n${css}`;
        } else {
          inlineCSS = css;
        }
      }
      const locDeps = deps?.filter((dep) => !util.isLikelyHttpURL(dep.specifier));
      if (locDeps?.length) {
        const s = new MagicString(code);
        locDeps.forEach((dep) => {
          const { specifier, importUrl, loc } = dep;
          const versionStr = clientDependencyGraph.get(specifier)?.version || clientDependencyGraph.initialVersion;
          let url = importUrl;
          if (url.includes("?")) {
            url = `"${url}&v=${versionStr}"`;
          } else {
            url = `"${url}?v=${versionStr}"`;
          }
          s.overwrite(loc.start, loc.end, url);
        });
        code = s.toString();
      }
      if (inlineCSS) {
        resBody += `\nimport { applyCSS as __applyCSS } from "${
          toLocalPath(alephPkgUri)
        }/framework/core/style.ts";\n__applyCSS(${JSON.stringify(specifier)}, ${JSON.stringify(inlineCSS)});`;
        deps = [...(deps || []), { specifier: alephPkgUri + "/framework/core/style.ts" }] as typeof deps;
      }
      clientDependencyGraph.mark(specifier, { deps });
      if (map) {
        const m = JSON.parse(map);
        if (!util.isLikelyHttpURL(specifier)) {
          m.sources = [`file://source/${util.trimPrefix(specifier, ".")}`];
        }
        m.sourcesContent = [rawCode];
        resBody = code +
          `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${btoa(JSON.stringify(m))}`;
      } else {
        resBody = code;
      }
    }
    return new Response(resBody, {
      headers: {
        "Content-Type": `${resType}; charset=utf-8`,
        "Etag": etag,
      },
    });
  },
};
