import { matchRoutes, toLocalPath } from "../lib/helpers.ts";
import { type Element, HTMLRewriter } from "../lib/html.ts";
import util from "../lib/util.ts";
import { getAlephPkgUri } from "./config.ts";
import type { DependencyGraph } from "./graph.ts";
import { importRouteModule } from "./routing.ts";
import type { RenderModule, Route, SSRContext } from "./types.ts";

export type RenderOptions = {
  indexHtml: string;
  routes: Route[];
  isDev: boolean;
  customHTMLRewriter: Map<string, HTMLRewriterHandlers>;
  ssr?: (ssr: SSRContext) => string | Promise<string>;
};

export default {
  async fetch(req: Request, ctx: Record<string, unknown>, options: RenderOptions): Promise<Response> {
    const { indexHtml, routes, isDev, customHTMLRewriter, ssr } = options;
    const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" });
    const ssrHTMLRewriter: Map<string, HTMLRewriterHandlers> = new Map();
    if (ssr) {
      const { url, modules } = await initSSR(req, ctx, routes);
      for (const { redirect } of modules) {
        if (redirect) {
          return new Response(null, redirect);
        }
      }
      try {
        const headCollection: string[] = [];
        const ssrOutput = await ssr({ url, modules, headCollection });
        if (modules.length > 0) {
          const serverDependencyGraph: DependencyGraph | undefined = Reflect.get(globalThis, "serverDependencyGraph");
          const styles: string[] = [];
          for (const { filename } of modules) {
            serverDependencyGraph?.walk(filename, (mod) => {
              if (mod.inlineCSS) {
                styles.push(`<style data-module-id="${mod.specifier}">${mod.inlineCSS}</style>`);
              }
            });
          }
          headCollection.push(...styles);
        }
        ssrHTMLRewriter.set("ssr-head", {
          element(el: Element) {
            headCollection.forEach((h) => util.isFilledString(h) && el.before(h, { html: true }));
            if (modules.length > 0) {
              const importStmts = modules.map(({ filename }, idx) =>
                `import $${idx} from ${JSON.stringify(filename.slice(1))};`
              ).join("");
              const kvs = modules.map(({ filename, data }, idx) =>
                `${JSON.stringify(filename)}:{defaultExport:$${idx}${data !== undefined ? ",withData:true" : ""}}`
              ).join(",");
              const ssrModules = modules.map(({ url, filename, error, data, dataCacheTtl }) => ({
                url: url.pathname + url.search,
                module: filename,
                error,
                data,
                dataCacheTtl,
              }));
              el.before(
                `<script id="ssr-modules" type="application/json">${JSON.stringify(ssrModules)}</script>`,
                {
                  html: true,
                },
              );
              el.before(`<script type="module">${importStmts}window.__ROUTE_MODULES={${kvs}};</script>`, {
                html: true,
              });
            }
            el.remove();
          },
        });
        ssrHTMLRewriter.set("ssr-body", {
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
      } catch (error) {
        ssrHTMLRewriter.set("ssr-head", {
          element(el: Element) {
            el.remove();
          },
        });
        ssrHTMLRewriter.set("ssr-body", {
          element(el: Element) {
            el.replace(`<code><pre>${error.stack}</pre></code>`, { html: true });
          },
        });
        headers.append("Cache-Control", "public, max-age=0, must-revalidate");
      }
    } else {
      const { mtime, size } = await Deno.lstat("./index.html");
      if (mtime) {
        const etag = mtime.getTime().toString(16) + "-" + size.toString(16);
        if (etag && req.headers.get("If-None-Match") === etag) {
          return new Response(null, { status: 304 });
        }
        headers.append("Etag", etag);
        headers.append("Last-Modified", mtime.toUTCString());
      }
      headers.append("Cache-Control", "public, max-age=0, must-revalidate");
    }
    const stream = new ReadableStream({
      start: (controller) => {
        const rewriter = new HTMLRewriter("utf8", (chunk: Uint8Array) => controller.enqueue(chunk));
        const alephPkgUri = getAlephPkgUri();
        const linkHandler = {
          element(el: Element) {
            let href = el.getAttribute("href");
            if (href) {
              const isHttpUrl = util.isLikelyHttpURL(href);
              if (!isHttpUrl) {
                href = util.cleanPath(href);
                el.setAttribute("href", href);
              }
              if (href.endsWith(".css") && !isHttpUrl && isDev) {
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
        ssrHTMLRewriter.forEach((handlers, selector) => rewriter.on(selector, handlers));
        rewriter.on("link", linkHandler);
        rewriter.on("script", scriptHandler);
        rewriter.on("head", commonHandler);
        rewriter.on("body", commonHandler);
        try {
          rewriter.write(util.utf8TextEncoder.encode(indexHtml));
          rewriter.end();
        } finally {
          controller.close();
          rewriter.free();
        }
      },
    });

    return new Response(stream, { headers });
  },
};

/** import route modules and fetch data for SSR */
async function initSSR(
  req: Request,
  ctx: Record<string, unknown>,
  routes: Route[],
): Promise<{ url: URL; modules: RenderModule[] }> {
  const url = new URL(req.url);
  const matches = matchRoutes(url, routes);
  const modules = await Promise.all(matches.map(async ([ret, { filename }]) => {
    const mod = await importRouteModule(filename);
    const dataConfig: Record<string, unknown> = util.isPlainObject(mod.data) ? mod.data : {};
    const rmod: RenderModule = {
      url: new URL(ret.pathname.input, url.href),
      filename: filename,
      defaultExport: mod.default,
      dataCacheTtl: dataConfig?.cacheTtl as (number | undefined),
    };
    const fetcher = dataConfig.get;
    if (typeof fetcher === "function") {
      let res = fetcher(req, { ...ctx, params: ret.pathname.groups });
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
