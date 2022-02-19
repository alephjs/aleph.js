import { createGenerator } from "https://esm.sh/@unocss/core@0.24.4";
import { transform } from "../compiler/mod.ts";
import type { ImportMap, TransformOptions } from "../compiler/types.d.ts";
import { readCode } from "../lib/fs.ts";
import { restoreUrl, toLocalPath } from "../lib/path.ts";
import { Loader, serveDir } from "../lib/serve.ts";
import util from "../lib/util.ts";
import type { AtomicCSSConfig, JSXConfig } from "../types.d.ts";
import { bundleCSS } from "./bundle.ts";
import { getAlephPkgUri } from "./config.ts";
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
  isDev: boolean;
  buildTarget: TransformOptions["target"];
  buildArgsHash: string;
  jsxConfig: JSXConfig;
  importMap: ImportMap;
  atomicCSS?: AtomicCSSConfig;
};

export const clientModuleTransformer = {
  fetch: async (req: Request, options: TransformeOptions): Promise<Response> => {
    const { isDev, buildArgsHash } = options;
    const { pathname, searchParams, search } = new URL(req.url);
    const specifier = pathname.startsWith("/-/") ? restoreUrl(pathname + search) : `.${pathname}`;
    const isJSX = pathname.endsWith(".jsx") || pathname.endsWith(".tsx");
    const isCSS = pathname.endsWith(".css");
    const [rawCode, mtime] = await readCode(specifier);
    const etag = mtime
      ? `${mtime.toString(16)}-${rawCode.length.toString(16)}-${
        rawCode.charCodeAt(Math.floor(rawCode.length / 2)).toString(16)
      }${buildArgsHash.slice(0, 8)}`
      : util.toHex(await crypto.subtle.digest("sha-1", enc.encode(rawCode + buildArgsHash)));
    if (req.headers.get("If-None-Match") === etag) {
      return new Response(null, { status: 304 });
    }

    let resBody = "";
    let resType = "application/javascript";

    if (isCSS) {
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
      const { atomicCSS, jsxConfig, importMap, buildTarget } = options;
      const graphVersions = clientDependencyGraph.modules.filter((mod) =>
        !util.isLikelyHttpURL(specifier) && !util.isLikelyHttpURL(mod.specifier) && mod.specifier !== specifier
      ).reduce((acc, { specifier, version }) => {
        acc[specifier] = version.toString(16);
        return acc;
      }, {} as Record<string, string>);
      const useAtomicCSS = Boolean(atomicCSS?.presets?.length) && isJSX;
      const alephPkgUri = getAlephPkgUri();
      const { code, jsxStaticClasses, deps } = await transform(specifier, rawCode, {
        ...jsxConfig,
        stripDataExport: isRouteFile(specifier),
        parseJsxStaticClasses: useAtomicCSS,
        target: buildTarget,
        alephPkgUri,
        graphVersions,
        importMap,
        isDev,
      });
      const atomicStyle = new Set(jsxStaticClasses?.map((name) => name.split(" ").map((name) => name.trim())).flat());
      let inlineCSS: string | null = null;
      if (useAtomicCSS && atomicStyle.size > 0) {
        const uno = createGenerator(atomicCSS);
        const { css } = await uno.generate(atomicStyle, { id: specifier, minify: !isDev });
        inlineCSS = css;
      }
      resBody = code +
        (inlineCSS
          ? `\nimport { applyCSS as __applyCSS } from "${toLocalPath(alephPkgUri)}framework/core/style.ts";` +
            `\n__applyCSS(${JSON.stringify(specifier)}, ${JSON.stringify(inlineCSS)});`
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
