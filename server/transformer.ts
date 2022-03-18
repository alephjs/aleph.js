import { extname } from "https://deno.land/std@0.128.0/path/mod.ts";
import { createGenerator } from "https://esm.sh/@unocss/core@0.28.0";
import { transform } from "../compiler/mod.ts";
import type { TransformOptions } from "../compiler/types.ts";
import { readCode } from "../lib/fs.ts";
import { restoreUrl, toLocalPath } from "../lib/helpers.ts";
import util from "../lib/util.ts";
import { bundleCSS } from "./bundle.ts";
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
      isCSS = lang === "css";
      enableAtomicCSS = lang === "tsx" || lang === "jsx";
    } else {
      const ext = extname(pathname);
      isCSS = ext === ".css" || ext === ".pcss" || ext === ".postcss";
      enableAtomicCSS = ext === ".jsx" || ext === ".tsx";
      [rawCode, mtime] = await readCode(specifier);
    }
    const etag = mtime
      ? `${mtime.toString(16)}-${rawCode.length.toString(16)}-${
        rawCode.charCodeAt(Math.floor(rawCode.length / 2)).toString(16)
      }${buildHash.slice(0, 8)}`
      : await util.computeHash("sha-1", rawCode + buildHash);
    if (req.headers.get("If-None-Match") === etag) {
      return new Response(null, { status: 304 });
    }

    let clientDependencyGraph: DependencyGraph | undefined = Reflect.get(globalThis, "clientDependencyGraph");
    if (!clientDependencyGraph) {
      clientDependencyGraph = new DependencyGraph();
      Reflect.set(globalThis, "clientDependencyGraph", clientDependencyGraph);
    }

    let resBody = "";
    let resType = "application/javascript";

    if (isCSS) {
      const jsModule = searchParams.has("module");
      const { code, deps } = await bundleCSS(specifier, rawCode, {
        targets: {
          android: 95,
          chrome: 95,
          edge: 95,
          firefox: 90,
          safari: 14,
        },
        minify: !isDev,
        cssModules: jsModule && ["css", "pcss", "postcss"].findIndex((ext) => pathname.endsWith(`.module.${ext}`)) > -1,
        jsModule,
        hmr: isDev,
      });
      resBody = code;
      if (!jsModule) {
        resType = "text/css";
      }
      clientDependencyGraph.mark(specifier, { deps: deps?.map((specifier) => ({ specifier })) });
    } else {
      const { atomicCSS, jsxConfig, importMap, buildTarget } = options;
      const graphVersions = clientDependencyGraph.modules.filter((mod) =>
        !util.isLikelyHttpURL(specifier) && !util.isLikelyHttpURL(mod.specifier) && mod.specifier !== specifier
      ).reduce((acc, { specifier, version }) => {
        acc[specifier] = version.toString(16);
        return acc;
      }, {} as Record<string, string>);
      const alephPkgUri = getAlephPkgUri();
      const { code, deps } = await transform(specifier, rawCode, {
        ...jsxConfig,
        lang: lang as TransformOptions["lang"],
        stripDataExport: isRouteFile(specifier),
        target: buildTarget ?? (isDev ? "es2022" : "es2015"),
        alephPkgUri,
        graphVersions,
        initialGraphVersion: clientDependencyGraph.initialVersion.toString(16),
        importMap: JSON.stringify(importMap),
        isDev,
      });
      let inlineCSS = loaded?.inlineCSS;
      if (Boolean(atomicCSS?.presets?.length) && enableAtomicCSS) {
        const uno = createGenerator(atomicCSS);
        const { css } = await uno.generate(rawCode, { id: specifier, minify: !isDev });
        if (inlineCSS) {
          inlineCSS = `${inlineCSS}\n${css}`;
        } else {
          inlineCSS = css;
        }
      }
      if (inlineCSS) {
        resBody = code +
          `\nimport { applyCSS as __applyCSS } from "${
            toLocalPath(alephPkgUri)
          }/framework/core/style.ts";\n__applyCSS(${JSON.stringify(specifier)}, ${JSON.stringify(inlineCSS)});`;
        deps?.push({ specifier: alephPkgUri + "/framework/core/style.ts" });
        clientDependencyGraph.mark(specifier, { deps });
      } else {
        resBody = code;
        clientDependencyGraph.mark(specifier, { deps });
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
