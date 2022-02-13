import { concat } from "https://deno.land/std@0.125.0/bytes/mod.ts";
import type { Element } from "https://deno.land/x/lol_html@0.0.2/types.d.ts";
import initWasm, { HTMLRewriter } from "https://deno.land/x/lol_html@0.0.2/mod.js";
import getWasm from "https://deno.land/x/lol_html@0.0.2/wasm.js";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import { VERSION } from "../version.ts";
import type { Context, RouteConfig, SSREvent } from "./types.d.ts";

let lolHtmlReady = false;

type Options = {
  indexHtml: string;
  ssrFn?: (e: SSREvent) => string;
};

export default {
  async fetch(req: Request, ctx: Context, { indexHtml, ssrFn }: Options): Promise<Response> {
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
        const route = await getRoute(req, ctx);
        if (route instanceof Response) {
          return route;
        }

        // ssr
        const headCollection: string[] = [];
        const ssrBody = ssrFn({ ...route, headCollection });
        rewriter.on("ssr-head", {
          element(el: Element) {
            if (route?.data) {
              el.before(`<script id="ssr-data" type="application/json">${JSON.stringify(route?.data)}</script>`, {
                html: true,
              });
            }
            headCollection.forEach((tag) => el.before(tag, { html: true }));
            el.remove();
          },
        });
        rewriter.on("ssr-body", {
          element(el: Element) {
            el.replace(ssrBody, { html: true });
          },
        });
        if (util.isNumber(route?.dataExpires)) {
          headers.append("Cache-Control", `public, max-age=${route?.dataExpires}`);
        } else {
          headers.append("Cache-Control", "public, max-age=0, must-revalidate");
        }
      } else {
        const stat = await Deno.lstat(`./index.html`);
        if (stat.mtime) {
          const mtimeUTC = stat.mtime.toUTCString();
          if (req.headers.get("If-Modified-Since") === mtimeUTC) {
            return new Response(null, { status: 304 });
          }
          headers.append("Last-Modified", mtimeUTC);
        } else {
          headers.append("Cache-Control", "public, max-age=0, must-revalidate");
        }
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
      rewriter.write((new TextEncoder()).encode(indexHtml));
      rewriter.end();
      return new Response(concat(...chunks), { headers });
    } catch (err) {
      log.error(err.stack);
      return new Response(ctx.env.ALEPH_ENV === "devlopment" ? err.message.split("\n")[0] : "Internal Server Error", {
        status: 500,
      });
    }
  },
};

async function getRoute(
  req: Request,
  ctx: Context,
): Promise<Response | { url: URL; component?: any; data?: any; dataExpires?: number }> {
  const url = new URL(req.url);
  const pathname = util.cleanPath(url.pathname);
  const routes: RouteConfig[] = (self as any).__ALEPH_ROUTES;
  if (util.isArray(routes)) {
    for (const [pattern, load] of routes) {
      const mod = await load();
      const route = {
        url,
        component: mod.component,
        dataExpires: mod.data?.cacheTtl,
      };
      const ret = pattern.exec({ pathname });
      if (ret) {
        route.url = util.appendUrlParams(url, ret.pathname.groups);
        const request = new Request(route.url.toString(), req);
        if (mod.data) {
          const fetcher = mod.data.get;
          if (util.isFunction(fetcher)) {
            const allFetcher = mod.data.all;
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
