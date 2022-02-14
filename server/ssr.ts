import { concat } from "https://deno.land/std@0.125.0/bytes/mod.ts";
import type { Element } from "https://deno.land/x/lol_html@0.0.2/types.d.ts";
import initWasm, { HTMLRewriter } from "https://deno.land/x/lol_html@0.0.2/mod.js";
import getWasm from "https://deno.land/x/lol_html@0.0.2/wasm.js";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import type { RouteConfig, SSREvent } from "../types.d.ts";
import { VERSION } from "../version.ts";

let lolHtmlReady = false;

type Options = {
  indexHtml: string;
  routes: RouteConfig[];
  ssrFn?: (e: SSREvent) => string;
};

export default {
  async fetch(
    req: Request,
    ctx: Record<string | symbol, any>,
    { indexHtml, routes, ssrFn }: Options,
  ): Promise<Response> {
    if (!lolHtmlReady) {
      await initWasm(getWasm());
      lolHtmlReady = true;
    }

    const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" });
    const chunks: Uint8Array[] = [];
    const rewriter = new HTMLRewriter("utf8", (chunk: Uint8Array) => {
      chunks.push(chunk);
    });

    try {
      if (ssrFn) {
        // get route
        const route = await matchRoute(req, ctx, routes);
        if (route instanceof Response) {
          return route;
        }

        // ssr
        const headCollection: string[] = [];
        const ssrBody = ssrFn({ ...route, headCollection });
        rewriter.on("ssr-head", {
          element(el: Element) {
            headCollection.forEach((tag) => el.before(tag, { html: true }));
            if (route.data) {
              const expiresAttr = route.dataExpires ? ` data-expires="route.dataExpires"` : "";
              el.before(
                `<script id="aleph-ssr-data" type="application/json"${expiresAttr}>${
                  JSON.stringify(route.data)
                }</script>`,
                {
                  html: true,
                },
              );
            }
            if (route.filename) {
              el.before(
                `<script type="module">import __ssrComponent from ${
                  JSON.stringify(route.filename)
                };Object.assign({__ssrComponent})</script>`,
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
            el.replace(ssrBody, { html: true });
          },
        });
        if (util.isNumber(route.dataExpires)) {
          headers.append("Cache-Control", `public, max-age=${route.dataExpires}`);
        } else {
          headers.append("Cache-Control", "public, max-age=0, must-revalidate");
        }
      } else {
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
      let nomoduleInserted = false;
      rewriter.on("script", {
        element(el: Element) {
          const src = el.getAttribute("src");
          const type = el.getAttribute("type");
          if (type === "module" && !nomoduleInserted) {
            el.after(`<script nomodule src="https://deno.land/x/aleph@v${VERSION}/lib/module.js"></script>`, {
              html: true,
            });
            nomoduleInserted = true;
          }
          if (src?.startsWith("./")) {
            el.setAttribute("src", src.slice(1));
          }
        },
      });
      rewriter.on("link", {
        element(el: Element) {
          const href = el.getAttribute("href");
          if (href?.startsWith("./")) {
            el.setAttribute("href", href.slice(1));
          }
        },
      });
      if (routes.length > 0) {
        const config = routes.map((r) => r[2]);
        rewriter.on("head", {
          element(el: Element) {
            el.append(
              `<script id="aleph-routes" type="application/json">${JSON.stringify(config)}</script>\n`,
              {
                html: true,
              },
            );
          },
        });
      }
      rewriter.write((new TextEncoder()).encode(indexHtml));
      rewriter.end();
      return new Response(concat(...chunks), { headers });
    } catch (err) {
      log.error(err.stack);
      return new Response(
        Deno.env.get("ALEPH_ENV") === "devlopment" ? err.message.split("\n")[0] : "Internal Server Error",
        {
          status: 500,
        },
      );
    }
  },
};

async function matchRoute(
  req: Request,
  ctx: Record<string | symbol, any>,
  routes: RouteConfig[],
): Promise<Response | { url: URL; component?: any; filename?: string; data?: any; dataExpires?: number }> {
  const url = new URL(req.url);
  if (routes.length > 0) {
    const pathname = util.cleanPath(url.pathname);
    for (const [pattern, load, meta] of routes) {
      const route = { url };
      const ret = pattern.exec({ pathname });
      if (ret) {
        const mod = await load();
        Object.assign(route, {
          url: util.appendUrlParams(url, ret.pathname.groups),
          component: mod.component,
          dataExpires: mod.dataMethods?.cacheTtl,
          filename: meta.filename,
        });
        const request = new Request(route.url.toString(), req);
        if (mod.dataMethods) {
          const fetcher = mod.dataMethods.get;
          if (util.isFunction(fetcher)) {
            const allFetcher = mod.dataMethods.all;
            if (util.isFunction(allFetcher)) {
              let res = allFetcher(request);
              if (res instanceof Promise) {
                res = await res;
              }
              if (res instanceof Response) {
                return res;
              }
            }
            let res = fetcher(request, ctx);
            if (res instanceof Promise) {
              res = await res;
            }
            if (res instanceof Response) {
              if (res.status !== 200) {
                return res;
              }
              // @ts-ignore
              route.data = await res.json();
            }
          }
        }
      }
      return route;
    }
  }
  return { url };
}
