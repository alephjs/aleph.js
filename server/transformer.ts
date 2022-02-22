import { createGenerator } from "https://esm.sh/@unocss/core@0.26.2";
import { fastTransform, transform, transformCSS } from "../compiler/mod.ts";
import type { ImportMap, TransformOptions } from "../compiler/types.d.ts";
import { readCode } from "../lib/fs.ts";
import { builtinModuleExts, restoreUrl, toLocalPath } from "../lib/path.ts";
import { Loader, serveDir } from "../lib/serve.ts";
import util from "../lib/util.ts";
import type { AlephConfig, AtomicCSSConfig, JSXConfig } from "../types.d.ts";
import { bundleCSS } from "./bundle.ts";
import { getAlephPkgUri } from "./config.ts";
import { isRouteFile } from "./routing.ts";
import type { DependencyGraph } from "./graph.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

const cssModuleLoader: Loader = {
  test: (url) => url.pathname.endsWith(".css"),
  load: async ({ pathname }, rawContent) => {
    const cssExports: Record<string, string> = {};
    if (pathname.endsWith(".module.css")) {
      const specifier = "." + pathname;
      const { exports } = await transformCSS(specifier, dec.decode(rawContent), {
        analyzeDependencies: false,
        cssModules: true,
        drafts: {
          nesting: true,
          customMedia: true,
        },
      });
      if (exports) {
        for (const [key, value] of Object.entries(exports)) {
          cssExports[key] = value.name;
        }
      }
    }
    return {
      content: enc.encode(`export default ${JSON.stringify(cssExports)};`),
      contentType: "application/javascript; charset=utf-8",
    };
  },
};

const esModuleLoader: Loader<{ importMap: ImportMap; initialGraphVersion: string }> = {
  test: (url) => builtinModuleExts.findIndex((ext) => url.pathname.endsWith(`.${ext}`)) !== -1,
  load: async ({ pathname }, rawContent, options) => {
    const config: AlephConfig | undefined = Reflect.get(globalThis, "__ALEPH_CONFIG");
    const specifier = "." + pathname;
    const isJSX = pathname.endsWith(".jsx") || pathname.endsWith(".tsx");
    const serverDependencyGraph: DependencyGraph | undefined = Reflect.get(globalThis, "serverDependencyGraph");
    if (serverDependencyGraph) {
      const graphVersions = serverDependencyGraph.modules.filter((mod) =>
        !util.isLikelyHttpURL(specifier) && !util.isLikelyHttpURL(mod.specifier) && mod.specifier !== specifier
      ).reduce((acc, { specifier, version }) => {
        acc[specifier] = version.toString(16);
        return acc;
      }, {} as Record<string, string>);
      const { code, deps } = await fastTransform(specifier, dec.decode(rawContent), {
        importMap: options?.importMap,
        initialGraphVersion: options?.initialGraphVersion,
        graphVersions,
      });
      serverDependencyGraph.mark(specifier, {
        deps,
        inlineCSS: Boolean(config?.atomicCSS?.presets?.length) && isJSX,
      });
      return {
        content: enc.encode(code),
      };
    }
    return {
      content: rawContent,
    };
  },
};

/** serve app modules to support module loader that allows you import NON-JS modules like `.css/.vue/.svelet`... */
export async function serveAppModules(port: number, importMap: ImportMap) {
  try {
    Deno.env.set("ALEPH_APP_MODULES_PORT", port.toString());
    await serveDir({
      port,
      loaders: [esModuleLoader, cssModuleLoader],
      loaderOptions: { importMap, initialGraphVersion: Date.now().toString(16) },
    });
  } catch (error) {
    if (error instanceof Deno.errors.AddrInUse) {
      await serveAppModules(port + 1, importMap);
    } else {
      throw error;
    }
  }
}

export type TransformerOptions = {
  isDev: boolean;
  buildTarget: TransformOptions["target"];
  buildArgsHash: string;
  jsxConfig: JSXConfig;
  importMap: ImportMap;
  atomicCSS?: AtomicCSSConfig;
};

export const clientModuleTransformer = {
  fetch: async (req: Request, options: TransformerOptions): Promise<Response> => {
    const clientDependencyGraph: DependencyGraph | undefined = Reflect.get(globalThis, "clientDependencyGraph");
    if (!clientDependencyGraph) {
      return new Response("Server is not ready", { status: 500 });
    }

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
      clientDependencyGraph.mark(specifier, { deps: deps?.map((specifier) => ({ specifier })) });
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
      const { code, deps } = await transform(specifier, rawCode, {
        ...jsxConfig,
        stripDataExport: isRouteFile(specifier),
        target: buildTarget,
        alephPkgUri,
        graphVersions,
        importMap,
        isDev,
      });
      let inlineCSS: string | null = null;
      if (useAtomicCSS) {
        const uno = createGenerator(atomicCSS);
        const { css } = await uno.generate(rawCode, { id: specifier, minify: !isDev });
        inlineCSS = css;
      }
      if (inlineCSS) {
        resBody = code +
          `\nimport { applyCSS as __apply_CSS } from "${toLocalPath(alephPkgUri)}framework/core/style.ts";__apply_CSS(${
            JSON.stringify(specifier)
          }, ${JSON.stringify(inlineCSS)});`;
        clientDependencyGraph.mark(specifier, { deps, inlineCSS: true });
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
