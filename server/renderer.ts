import { createGenerator } from "https://esm.sh/@unocss/core@0.26.2";
import { concat } from "https://deno.land/std@0.125.0/bytes/mod.ts";
import type { Element } from "https://deno.land/x/lol_html@0.0.2/types.d.ts";
import initWasm, { HTMLRewriter } from "https://deno.land/x/lol_html@0.0.2/mod.js";
import decodeWasm from "https://deno.land/x/lol_html@0.0.2/wasm.js";
import { matchRoute, toLocalPath } from "../lib/helpers.ts";
import util from "../lib/util.ts";
import { getAlephPkgUri } from "./config.ts";
import type { DependencyGraph, Module } from "./graph.ts";
import { bundleCSS } from "./bundle.ts";
import { importRouteModule } from "./routing.ts";
import type { AlephConfig, FetchContext, HTMLRewriterHandlers, RenderModule, Route, SSRContext } from "./types.ts";

let lolHtmlReady = false;

export type RenderOptions = {
  indexHtml: string;
  routes: Route[];
  isDev: boolean;
  customHTMLRewriter: Map<string, HTMLRewriterHandlers>;
  hmrWebSocketUrl?: string;
  ssrHandler?: (ssr: SSRContext) => string | undefined | Promise<string | undefined>;
};

export default {
  async fetch(req: Request, ctx: FetchContext, options: RenderOptions): Promise<Response> {
    if (!lolHtmlReady) {
      await initWasm(decodeWasm());
      lolHtmlReady = true;
    }

    const { indexHtml, routes, isDev, customHTMLRewriter, ssrHandler, hmrWebSocketUrl } = options;
    const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" });
    const chunks: Uint8Array[] = [];
    const rewriter = new HTMLRewriter("utf8", (chunk: Uint8Array) => {
      chunks.push(chunk);
    });

    let ssr = false;
    if (ssrHandler) {
      const { url, modules } = await initSSR(req, ctx, routes);
      for (const { redirect } of modules) {
        if (redirect) {
          return new Response(null, redirect);
        }
      }

      try {
        const headCollection: string[] = [];
        const ssrOutput = await ssrHandler({ url, modules, headCollection });
        if (typeof ssrOutput === "string") {
          if (modules.length > 0) {
            const serverDependencyGraph: DependencyGraph | undefined = Reflect.get(
              globalThis,
              "serverDependencyGraph",
            );
            const styleModules: Module[] = [];
            for (const { filename } of modules) {
              serverDependencyGraph?.walk(filename, (mod) => {
                if (mod.inlineCSS || mod.specifier.endsWith(".css")) {
                  styleModules.push(mod);
                }
              });
            }
            const styles = await Promise.all(styleModules.map(async (mod) => {
              const rawCode = await Deno.readTextFile(mod.specifier);
              if (mod.specifier.endsWith(".css")) {
                const { code } = await bundleCSS(mod.specifier, rawCode, { minify: !isDev });
                return `<style data-module-id="${mod.specifier}">${code}</style>`;
              }
              if (mod.inlineCSS) {
                const config: AlephConfig | undefined = Reflect.get(globalThis, "__ALEPH_CONFIG");
                const uno = createGenerator(config?.atomicCSS);
                const { css } = await uno.generate(rawCode, { id: mod.specifier, minify: !isDev });
                if (css) {
                  return `<style data-module-id="${mod.specifier}">${css}</style>`;
                }
              }
              return "";
            }));
            headCollection.push(...styles);
          }
          rewriter.on("ssr-head", {
            element(el: Element) {
              headCollection.forEach((h) => util.isFilledString(h) && el.before(h, { html: true }));
              if (modules.length > 0) {
                const importStmts = modules.map(({ filename }, idx) =>
                  `import mod_${idx} from ${JSON.stringify(filename.slice(1))};`
                ).join("");
                const kvs = modules.map(({ filename }, idx) => `${JSON.stringify(filename)}:mod_${idx}`).join(",");
                const ssrModules = modules.map(({ url, filename, error, data, dataCacheTtl }) => ({
                  url: url.pathname + url.search,
                  module: filename,
                  error,
                  data,
                  dataCacheTtl,
                }));
                el.before(`<script id="ssr-modules" type="application/json">${JSON.stringify(ssrModules)}</script>`, {
                  html: true,
                });
                el.before(`<script type="module">${importStmts}window.__ROUTE_MODULES={${kvs}};</script>`, {
                  html: true,
                });
              }
              el.remove();
            },
          });
          rewriter.on("ssr-body", {
            element(el: Element) {
              el.replace(ssrOutput, { html: true });
            },
          });
          const ttls = modules.filter(({ dataCacheTtl }) =>
            typeof dataCacheTtl === "number" && !Number.isNaN(dataCacheTtl) && dataCacheTtl > 0
          ).map(({ dataCacheTtl }) => Number(dataCacheTtl));
          if (ttls.length > 1) {
            headers.append("Cache-Control", `public, max-age=${Math.min(...ttls)}`);
          } else if (ttls.length == 1) {
            headers.append("Cache-Control", `public, max-age=${ttls[0]}`);
          } else {
            headers.append("Cache-Control", "public, max-age=0, must-revalidate");
          }
          ssr = true;
        }
      } catch (error) {
        rewriter.on("ssr-head", {
          element(el: Element) {
            el.remove();
          },
        });
        rewriter.on("ssr-body", {
          element(el: Element) {
            el.replace(`<code><pre>${error.stack}</pre></code>`, { html: true });
          },
        });
        headers.append("Cache-Control", "public, max-age=0, must-revalidate");
        ssr = true;
      }
    }

    if (!ssr) {
      const stat = await Deno.lstat("./index.html");
      if (stat.mtime) {
        const mtimeUTC = stat.mtime.toUTCString();
        if (req.headers.get("If-Modified-Since") === mtimeUTC) {
          return new Response(null, { status: 304 });
        }
        headers.append("Last-Modified", mtimeUTC);
      }
      headers.append("Cache-Control", "public, max-age=0, must-revalidate");
    }

    const alephPkgUri = getAlephPkgUri();
    const linkHandler = {
      element(el: Element) {
        let href = el.getAttribute("href");
        if (href) {
          const isUrl = util.isLikelyHttpURL(href);
          if (!isUrl) {
            href = util.cleanPath(href);
            el.setAttribute("href", href);
          }
          if (href.endsWith(".css") && !isUrl && isDev) {
            const specifier = `.${href}`;
            el.setAttribute("data-module-id", specifier);
            el.after(
              `<script type="module">import hot from "${toLocalPath(alephPkgUri)}/framework/core/hmr.ts";hot(${
                JSON.stringify(specifier)
              }).accept();</script>`,
              { html: true },
            );
          }
        }
      },
    };
    const scriptHandler = {
      nomoduleInserted: false,
      element(el: Element) {
        const src = el.getAttribute("src");
        if (src && !util.isLikelyHttpURL(src)) {
          el.setAttribute("src", util.cleanPath(src));
        }
        if (el.getAttribute("type") === "module" && !scriptHandler.nomoduleInserted) {
          el.after(`<script nomodule src="${alephPkgUri}/lib/nomodule.js"></script>`, { html: true });
          scriptHandler.nomoduleInserted = true;
        }
      },
    };
    const commonHandler = {
      handled: false,
      element(el: Element) {
        if (commonHandler.handled) {
          return;
        }
        if (routes.length > 0) {
          const json = JSON.stringify({ routes: routes.map(([_, meta]) => meta) });
          el.append(`<script id="route-manifest" type="application/json">${json}</script>`, {
            html: true,
          });
        }
        if (isDev) {
          if (hmrWebSocketUrl) {
            el.append(`<script>window.__hmrWebSocketUrl=${JSON.stringify(hmrWebSocketUrl)};</script>`, { html: true });
          }
          el.append(
            `<script type="module">import hot from "${
              toLocalPath(alephPkgUri)
            }/framework/core/hmr.ts";hot("./index.html").decline();</script>`,
            { html: true },
          );
          commonHandler.handled = true;
        }
      },
    };

    customHTMLRewriter.forEach((handlers, selector) => rewriter.on(selector, handlers));
    rewriter.on("link", linkHandler);
    rewriter.on("script", scriptHandler);
    rewriter.on("head", commonHandler);
    rewriter.on("body", commonHandler);
    rewriter.write((new TextEncoder()).encode(indexHtml));
    rewriter.end();

    return new Response(concat(...chunks), { headers });
  },
};

/** import route modules and fetch data for SSR */
async function initSSR(
  req: Request,
  ctx: FetchContext,
  routes: Route[],
): Promise<{ url: URL; modules: RenderModule[] }> {
  const url = new URL(req.url);
  const matches = matchRoute(url, routes);
  const modules = await Promise.all(matches.map(async ([ret, { filename }]) => {
    const mod = await importRouteModule(filename);
    const dataConfig: Record<string, unknown> = util.isPlainObject(mod.data) ? mod.data : {};
    const rmod: RenderModule = {
      url: util.appendUrlParams(new URL(ret.pathname.input, url.href), ret.pathname.groups),
      filename: filename,
      defaultExport: mod.default,
      dataCacheTtl: dataConfig?.cacheTtl as (number | undefined),
    };
    const fetcher = dataConfig.get;
    if (typeof fetcher === "function") {
      const request = new Request(rmod.url.toString(), req);
      let res = fetcher(request, ctx);
      if (res instanceof Promise) {
        res = await res;
      }
      if (res instanceof Response) {
        if (res.status >= 400) {
          rmod.error = { message: await res.text(), status: res.status };
          return rmod;
        }
        if (res.status >= 300) {
          if (res.headers.has("Location")) {
            rmod.redirect = { headers: res.headers, status: res.status };
          } else {
            rmod.error = { message: "Missing the `Location` header", status: 400 };
          }
          return rmod;
        }
        try {
          rmod.data = await res.json();
        } catch (_e) {
          rmod.error = { message: "Data must be valid JSON", status: 400 };
        }
      }
    }
    return rmod;
  }));

  return { url, modules: modules.filter(({ defaultExport }) => defaultExport !== undefined) };
}
