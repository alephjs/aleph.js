import { createGenerator } from "https://esm.sh/@unocss/core@0.26.2";
import { concat } from "https://deno.land/std@0.125.0/bytes/mod.ts";
import type { Element } from "https://deno.land/x/lol_html@0.0.2/types.d.ts";
import initWasm, { HTMLRewriter } from "https://deno.land/x/lol_html@0.0.2/mod.js";
import decodeWasm from "https://deno.land/x/lol_html@0.0.2/wasm.js";
import log from "../lib/log.ts";
import { toLocalPath } from "../lib/path.ts";
import util from "../lib/util.ts";
import { getAlephPkgUri } from "./config.ts";
import type { DependencyGraph, Module } from "./graph.ts";
import { bundleCSS } from "./bundle.ts";
import type { AlephConfig, FetchContext, HTMLRewriterHandlers, Route, SSRContext, SSRModule } from "./types.ts";

let lolHtmlReady = false;

export type RenderOptions = {
  indexHtml: string;
  routes: Route[];
  isDev: boolean;
  customHTMLRewriter: Map<string, HTMLRewriterHandlers>;
  ssrHandler?: (ssr: SSRContext) => string | undefined | Promise<string | undefined>;
  hmrWebSocketUrl?: string;
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

    try {
      let withSSR = false;

      if (ssrHandler) {
        const res = await loadPageData(req, ctx, routes);
        if (res instanceof Response) {
          return res;
        }

        // ssr
        const headCollection: string[] = [];
        const ssrOutput = await ssrHandler({ ...res, headCollection });
        if (typeof ssrOutput === "string") {
          if (res.imports.length > 0) {
            const serverDependencyGraph: DependencyGraph | undefined = Reflect.get(
              globalThis,
              "serverDependencyGraph",
            );
            const styleModules: Module[] = [];
            for (const { filename } of res.imports) {
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
              // vue/svelte
              return `<style data-module-id="${mod.specifier}">/* todo */</style>`;
            }));
            headCollection.push(...styles);
          }
          rewriter.on("ssr-head", {
            element(el: Element) {
              headCollection.forEach((tag) => el.before(tag, { html: true }));
              const imports = res.imports
                .filter(({ defaultExport }) => defaultExport !== undefined)
                .map(({ filename }, idx) =>
                  `import mod_${idx} from ${JSON.stringify(filename.slice(1))};__ssrModules[${
                    JSON.stringify(filename)
                  }]={default:mod_${idx}};`
                );
              if (imports.length > 0) {
                el.before(
                  `<script type="module">window.__ssrModules={};${imports.join("")}</script>`,
                  {
                    html: true,
                  },
                );
              }
              const data = res.imports.map(({ url, data, dataCacheTtl }) => ({
                url: url.pathname + url.search,
                data,
                dataCacheTtl,
              }));
              if (data.length > 0) {
                el.before(
                  `<script id="aleph-ssr-data" type="application/json">${JSON.stringify(data)}</script>`,
                  {
                    html: true,
                  },
                );
              }
              el.remove();
            },
          });
          rewriter.on("ssr-body", {
            element(el: Element) {
              el.replace(ssrOutput, { html: true });
            },
          });
          const ttls = res.imports.filter(({ dataCacheTtl }) =>
            typeof dataCacheTtl === "number" && !Number.isNaN(dataCacheTtl) && dataCacheTtl > 0
          ).map(({ dataCacheTtl }) => Number(dataCacheTtl));
          if (ttls.length > 1) {
            headers.append("Cache-Control", `public, max-age=${Math.min(...ttls)}`);
          } else if (ttls.length == 1) {
            headers.append("Cache-Control", `public, max-age=${ttls[0]}`);
          } else {
            headers.append("Cache-Control", "public, max-age=0, must-revalidate");
          }
          withSSR = true;
        }
      }

      if (!withSSR) {
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
            if (href.startsWith("./")) {
              href = href.slice(1);
            }
            el.setAttribute("href", href);
            if (href.endsWith(".css") && href.startsWith("/") && isDev) {
              el.after(
                `<script type="module">import hot from "${toLocalPath(alephPkgUri)}/framework/core/hmr.ts";hot(${
                  JSON.stringify(`.${href}`)
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
          const type = el.getAttribute("type");
          if (type === "module" && !scriptHandler.nomoduleInserted) {
            el.after(`<script nomodule src="${alephPkgUri}/lib/nomodule.js"></script>`, { html: true });
            scriptHandler.nomoduleInserted = true;
          }
          if (src?.startsWith("./")) {
            el.setAttribute("src", src.slice(1));
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
            const config = routes.map((r) => r[2]);
            el.append(`<script id="aleph-routes" type="application/json">${JSON.stringify(config)}</script>`, {
              html: true,
            });
          }
          if (isDev) {
            el.append(
              `<script type="module">window.__hmrWebSocketUrl=${JSON.stringify(hmrWebSocketUrl)};import hot from "${
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
    } catch (err) {
      log.error(err.stack);
      return new Response(isDev ? err.message : "Internal Server Error", {
        status: 500,
      });
    }
  },
};

async function loadPageData(
  req: Request,
  ctx: FetchContext,
  routes: Route[],
): Promise<Response | { url: URL; imports: SSRModule[] }> {
  const url = new URL(req.url);
  const loads: (() => Promise<SSRModule>)[] = [];
  if (routes.length > 0) {
    routes.forEach(([pattern, load, meta]) => {
      let ret = pattern.exec({ pathname: url.pathname });
      if (!ret) {
        ret = pattern.exec({ pathname: "/_app" });
      }
      if (ret) {
        loads.push(async () => {
          const mod = await load();
          const dataConfig: Record<string, unknown> = util.isPlainObject(mod.data) ? mod.data : {};
          const ssrModule: SSRModule = {
            url: util.appendUrlParams(new URL(ret.pathname.input, url.href), ret.pathname.groups),
            filename: meta.filename,
            defaultExport: mod.default,
            dataCacheTtl: dataConfig?.cacheTtl as (number | undefined),
          };
          const fetcher = dataConfig.get;
          if (typeof fetcher === "function") {
            const request = new Request(ssrModule.url.toString(), req);
            const allFetcher = dataConfig.all;
            if (typeof allFetcher === "function") {
              let res = allFetcher(request);
              if (res instanceof Promise) {
                res = await res;
              }
              if (res instanceof Response) {
                Reflect.set(ssrModule, "respond", res);
                return ssrModule;
              }
            }
            let res = fetcher(request, ctx);
            if (res instanceof Promise) {
              res = await res;
            }
            if (res instanceof Response) {
              if (res.status !== 200) {
                Reflect.set(ssrModule, "respond", res);
                return ssrModule;
              }
              Reflect.set(ssrModule, "data", await res.json());
            }
          }
          return ssrModule;
        });
      }
    });
    return { url, imports: await Promise.all(loads.map((load) => load())) };
  }
  return { url, imports: [] };
}
