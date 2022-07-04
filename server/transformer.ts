import { TransformError } from "../framework/core/error.ts";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import { bundleCSS } from "./bundle.ts";
import type { TransformOptions, TransformResult } from "./deps.ts";
import { MagicString, parseDeps, transform } from "./deps.ts";
import depGraph from "./graph.ts";
import {
  builtinModuleExts,
  getAlephConfig,
  getAlephPkgUri,
  getDeploymentId,
  getUnoGenerator,
  readCode,
  regFullVersion,
  restoreUrl,
  toLocalPath,
} from "./helpers.ts";
import { getContentType } from "./media_type.ts";
import { isRouteFile } from "./routing.ts";
import type { ImportMap, JSXConfig, ModuleLoader, ModuleLoaderOutput } from "./types.ts";

const cache = new Map<string, [content: string, headers: Headers]>();

export type TransformerOptions = {
  buildTarget?: TransformOptions["target"];
  importMap: ImportMap;
  jsxConfig: JSXConfig;
  loader?: ModuleLoader;
};

export default {
  test: (pathname: string) => {
    return (
      pathname.startsWith("/-/") ||
      (builtinModuleExts.find((ext) => pathname.endsWith(`.${ext}`)) &&
        !pathname.endsWith(".d.ts")) ||
      pathname.endsWith(".css")
    );
  },
  fetch: async (
    req: Request,
    options: TransformerOptions,
  ): Promise<Response> => {
    const { buildTarget, loader, jsxConfig, importMap } = options;
    const { pathname, searchParams, search } = new URL(req.url);
    const specifier = pathname.startsWith("/-/") ? restoreUrl(pathname + search) : `.${pathname}`;
    const ssr = searchParams.has("ssr");
    const isDev = Deno.env.get("ALEPH_ENV") === "development";

    const deployId = getDeploymentId();
    const etag = deployId ? `W/${deployId}` : null;
    if (etag && req.headers.get("If-None-Match") === etag) {
      return new Response(null, { status: 304 });
    }

    const [sourceRaw, sourceContentType] = await readCode(specifier);
    let source = sourceRaw;
    let lang: ModuleLoaderOutput["lang"];
    let inlineCSS: string | undefined;
    let isCSS = false;
    if (loader) {
      const loaded = await loader.load(
        specifier,
        sourceRaw,
        ssr ? { jsxConfig, importMap, ssr: true } : { ...options, isDev },
      );
      source = loaded.code;
      lang = loaded.lang;
      inlineCSS = loaded.inlineCSS;
    } else {
      isCSS = sourceContentType.startsWith("text/css");
    }

    // transform module for SSR
    if (ssr) {
      let contentType = sourceContentType;
      if (lang) {
        contentType = getContentType(`file.${lang}`);
      }
      const deps = await parseDeps(specifier, source, {
        importMap: JSON.stringify(importMap),
        lang,
      });
      depGraph.mark(specifier, { deps, inlineCSS });
      if (deps.length) {
        const s = new MagicString(source);
        deps.forEach((dep) => {
          const { specifier, importUrl, loc } = dep;
          if (!util.isLikelyHttpURL(specifier) && loc) {
            let url: string;
            const importUrlPrefix = importUrl +
              (importUrl.includes("?") ? "&" : "?");
            const version = depGraph.get(specifier)?.version;
            if (version) {
              url = `"${importUrlPrefix}ssr&v=${version.toString(36)}"`;
            } else {
              url = `"${importUrlPrefix}ssr"`;
            }
            s.overwrite(loc.start - 1, loc.end - 1, url);
          }
        });
        return new Response(s.toString(), {
          headers: [["Content-Type", contentType]],
        });
      }
      return new Response(source, { headers: [["Content-Type", contentType]] });
    }

    // check cached module
    const cacheKey = pathname + search;
    if (!isDev && cache.has(cacheKey)) {
      const [content, cachedHeaders] = cache.get(cacheKey)!;
      const headers = new Headers(cachedHeaders);
      headers.set("Cache-Hit", "true");
      return new Response(content, { headers });
    }

    let resBody = "";
    let resType = "application/javascript";

    try {
      if (isCSS) {
        const asJsModule = searchParams.has("module");
        const { code, deps } = await bundleCSS(specifier, source, {
          // todo: support borwserslist
          targets: {
            android: 95,
            chrome: 95,
            edge: 95,
            firefox: 90,
            safari: 14,
          },
          minify: !isDev,
          cssModules: asJsModule && pathname.endsWith(".module.css"),
          asJsModule,
          hmr: isDev,
        });
        depGraph.mark(specifier, {
          deps: deps?.map((specifier) => ({ specifier })),
        });
        resBody = code;
        if (!asJsModule) {
          resType = "text/css";
        }
      } else {
        const config = getAlephConfig();
        const alephPkgUri = getAlephPkgUri();
        let code: string;
        let map: string | undefined;
        let deps: TransformResult["deps"];
        let hasInlineCSS = false;
        if (
          util.isLikelyHttpURL(specifier) &&
          !specifier.startsWith("https://aleph/") &&
          (
            /^https?:\/\/(cdn\.)?esm\.sh\//i.test(specifier) ||
            /^(text|application)\/javascript/i.test(sourceContentType)
          )
        ) {
          // don't transform js modules imported from remote CDN
          deps = await parseDeps(specifier, source, {
            importMap: JSON.stringify(importMap),
            lang: "js",
          });
          if (deps.length > 0) {
            const s = new MagicString(source);
            deps.forEach((dep) => {
              const { importUrl, loc } = dep;
              if (loc) {
                s.overwrite(
                  loc.start - 1,
                  loc.end - 1,
                  `"${toLocalPath(importUrl)}"`,
                );
              }
            });
            code = s.toString();
          } else {
            code = source;
          }
        } else {
          const graphVersions = Object.fromEntries(
            depGraph.modules.filter((mod) => (
              !util.isLikelyHttpURL(specifier) &&
              !util.isLikelyHttpURL(mod.specifier) &&
              mod.specifier !== specifier
            )).map((
              { specifier, version },
            ) => [specifier, version.toString(36)]),
          );
          const ret = await transform(specifier, source, {
            ...jsxConfig,
            alephPkgUri,
            lang: lang as TransformOptions["lang"],
            target: buildTarget ?? "es2022",
            importMap: JSON.stringify(importMap),
            graphVersions,
            globalVersion: depGraph.globalVersion.toString(36),
            stripDataExport: isRouteFile(specifier),
            sourceMap: isDev,
            minify: isDev ? undefined : { compress: true },
            isDev,
          });
          code = ret.code;
          map = ret.map;
          deps = ret.deps;
        }
        const styleTs = `${alephPkgUri}/framework/core/style.ts`;
        if (isDev && config?.unocss) {
          const { presets, test } = config.unocss;
          if (
            Array.isArray(presets) &&
            (test instanceof RegExp ? test : /\.(jsx|tsx)$/).test(pathname)
          ) {
            try {
              const unoGenerator = getUnoGenerator();
              if (unoGenerator) {
                const { css } = await unoGenerator.generate(source, {
                  id: specifier,
                  minify: !isDev,
                });
                if (css) {
                  code += `\nimport { applyUnoCSS as __applyUnoCSS } from "${toLocalPath(styleTs)}";\n__applyUnoCSS(${
                    JSON.stringify(specifier)
                  }, ${JSON.stringify(css)});\n`;
                  hasInlineCSS = true;
                }
              }
            } catch (e) {
              log.warn("[UnoCSS]", e);
            }
          }
        }
        if (inlineCSS) {
          code += `\nimport { applyCSS as __applyCSS } from "${toLocalPath(styleTs)}";\n__applyCSS(${
            JSON.stringify(specifier)
          }, ${JSON.stringify(inlineCSS)});\n`;
          hasInlineCSS = true;
        }
        if (hasInlineCSS) {
          deps = [...(deps || []), { specifier: styleTs }] as typeof deps;
        }
        depGraph.mark(specifier, { deps });
        if (map) {
          try {
            const m = JSON.parse(map);
            if (!util.isLikelyHttpURL(specifier)) {
              m.sources = [`file://source${util.trimPrefix(specifier, ".")}`];
            }
            // todo: merge loader map
            m.sourcesContent = [source];
            resBody = code +
              `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${btoa(JSON.stringify(m))}\n`;
          } catch (e) {
            log.debug(`[dev] Failed to add source map for '${specifier}'`, e);
            resBody = code;
          }
        } else {
          resBody = code;
        }
      }
    } catch (error) {
      if (error.message === "unreachable") {
        resBody = source;
        resType = sourceContentType;
      } else {
        throw new TransformError(specifier, source, error.message, error.stack);
      }
    }

    const headers = new Headers([[
      "Content-Type",
      `${resType}; charset=utf-8`,
    ]]);
    if (etag) {
      headers.set("ETag", etag);
    }
    if (
      searchParams.get("v") ||
      (pathname.startsWith("/-/") && regFullVersion.test(pathname))
    ) {
      headers.append("Cache-Control", "public, max-age=31536000, immutable");
    }
    if (!isDev) {
      cache.set(cacheKey, [resBody, headers]);
    }
    return new Response(resBody, { headers });
  },
};
