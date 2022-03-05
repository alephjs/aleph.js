import { createGenerator } from "https://esm.sh/@unocss/core@0.26.2";
import { fastTransform, transform } from "../compiler/mod.ts";
import type { ImportMap, TransformOptions } from "../compiler/types.ts";
import { readCode } from "../lib/fs.ts";
import { builtinModuleExts, restoreUrl, toLocalPath } from "../lib/helpers.ts";
import log from "../lib/log.ts";
import { Loader, serveDir } from "../lib/serve.ts";
import util from "../lib/util.ts";
import { bundleCSS } from "./bundle.ts";
import { getAlephPkgUri } from "./config.ts";
import { isRouteFile } from "./routing.ts";
import { DependencyGraph } from "./graph.ts";
import type { AlephConfig, AtomicCSSConfig, JSXConfig } from "./types.ts";

const cssModuleLoader: Loader = {
  test: (url) => url.pathname.endsWith(".css"),
  load: async ({ pathname }, rawContent) => {
    const specifier = "." + pathname;
    const isDev = Deno.env.get("ALEPH_ENV") === "development";
    const { code, cssModulesExports, deps } = await bundleCSS(
      specifier,
      util.utf8TextDecoder.decode(rawContent),
      {
        targets: {
          android: 95,
          chrome: 95,
          edge: 95,
          firefox: 90,
          safari: 14,
        },
        minify: !isDev,
        cssModules: pathname.endsWith(".module.css"),
      },
    );
    const serverDependencyGraph: DependencyGraph | undefined = Reflect.get(globalThis, "serverDependencyGraph");
    if (serverDependencyGraph) {
      serverDependencyGraph.mark(specifier, { deps: deps?.map((specifier) => ({ specifier })), inlineCSS: code });
    }
    return {
      content: util.utf8TextEncoder.encode(`export default ${JSON.stringify(cssModulesExports)};`),
      contentType: "application/javascript; charset=utf-8",
    };
  },
};

const esModuleLoader: Loader<{ importMap: ImportMap }> = {
  test: (url) => builtinModuleExts.findIndex((ext) => url.pathname.endsWith(`.${ext}`)) !== -1,
  load: async ({ pathname }, rawContent, options) => {
    const config: AlephConfig | undefined = Reflect.get(globalThis, "__ALEPH_SERVER_CONFIG");
    const specifier = "." + pathname;
    const isJSX = pathname.endsWith(".jsx") || pathname.endsWith(".tsx");
    const isDev = Deno.env.get("ALEPH_ENV") === "development";
    const serverDependencyGraph: DependencyGraph | undefined = Reflect.get(globalThis, "serverDependencyGraph");
    if (serverDependencyGraph) {
      const graphVersions = serverDependencyGraph.modules.filter((mod) =>
        !util.isLikelyHttpURL(specifier) && !util.isLikelyHttpURL(mod.specifier) && mod.specifier !== specifier
      ).reduce((acc, { specifier, version }) => {
        acc[specifier] = version.toString(16);
        return acc;
      }, {} as Record<string, string>);
      const { code, deps } = await fastTransform(specifier, util.utf8TextDecoder.decode(rawContent), {
        importMap: JSON.stringify(options?.importMap),
        initialGraphVersion: serverDependencyGraph.initialVersion.toString(16),
        graphVersions,
      });
      let inlineCSS: string | undefined = undefined;
      if (Boolean(config?.atomicCSS?.presets?.length) && isJSX) {
        const uno = createGenerator(config?.atomicCSS);
        const { css } = await uno.generate(util.utf8TextDecoder.decode(rawContent), {
          id: specifier,
          minify: !isDev,
        });
        if (css) {
          inlineCSS = css;
        }
      }
      serverDependencyGraph.mark(specifier, { deps, inlineCSS });
      return {
        content: util.utf8TextEncoder.encode(code),
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
    log.debug(`Serve app modules on http://localhost:${port}`);
    Deno.env.set("ALEPH_APP_MODULES_PORT", port.toString());
    if (!Reflect.has(globalThis, "serverDependencyGraph")) {
      Reflect.set(globalThis, "serverDependencyGraph", new DependencyGraph());
    }
    await serveDir({
      port,
      loaders: [esModuleLoader, cssModuleLoader],
      loaderOptions: { importMap },
    });
  } catch (error) {
    if (error instanceof Deno.errors.AddrInUse) {
      serveAppModules(port + 1, importMap);
    } else {
      throw error;
    }
  }
}

export type TransformerOptions = {
  atomicCSS?: AtomicCSSConfig;
  buildHash: string;
  buildTarget?: TransformOptions["target"];
  importMap: ImportMap;
  isDev: boolean;
  jsxConfig: JSXConfig;
};

export const clientModuleTransformer = {
  fetch: async (req: Request, options: TransformerOptions): Promise<Response> => {
    const { isDev, buildHash } = options;
    const { pathname, searchParams, search } = new URL(req.url);
    const specifier = pathname.startsWith("/-/") ? restoreUrl(pathname + search) : `.${pathname}`;
    const isJSX = pathname.endsWith(".jsx") || pathname.endsWith(".tsx");
    const isCSS = pathname.endsWith(".css");
    const [rawCode, mtime] = await readCode(specifier);
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
      const toJS = searchParams.has("module");
      const { code, deps } = await bundleCSS(specifier, rawCode, {
        targets: {
          android: 95,
          chrome: 95,
          edge: 95,
          firefox: 90,
          safari: 14,
        },
        minify: !isDev,
        cssModules: toJS && pathname.endsWith(".module.css"),
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
      const alephPkgUri = getAlephPkgUri();
      const { code, deps } = await transform(specifier, rawCode, {
        ...jsxConfig,
        stripDataExport: isRouteFile(specifier),
        target: buildTarget ?? (isDev ? "es2022" : "es2015"),
        alephPkgUri,
        graphVersions,
        initialGraphVersion: clientDependencyGraph.initialVersion.toString(16),
        importMap: JSON.stringify(importMap),
        isDev,
      });
      let inlineCSS: string | null = null;
      if (Boolean(atomicCSS?.presets?.length) && isJSX) {
        const uno = createGenerator(atomicCSS);
        const { css } = await uno.generate(rawCode, { id: specifier, minify: !isDev });
        inlineCSS = css;
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
