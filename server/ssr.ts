import { concat } from "https://deno.land/std@0.125.0/bytes/mod.ts";
import type { Element } from "https://deno.land/x/lol_html@0.0.2/types.d.ts";
import init, { HTMLRewriter } from "https://deno.land/x/lol_html@0.0.2/mod.js";
import wasm from "https://deno.land/x/lol_html@0.0.2/wasm.js";
import util from "../lib/util.ts";
import { encoder } from "../lib/crypto.ts";

let lolHtmlReady = false;

async function fetchData(
  req: Request,
  ctx: any,
): Promise<void | Response | { data: object; cacheTtl?: number }> {
  const url = new URL(req.url);
  const pathname = util.cleanPath(url.pathname);
  const dataRoutes: [URLPattern, Record<string, any>][] = (self as any).__ALEPH_DATA_ROUTES;
  if (util.isArray(dataRoutes)) {
    for (const [pattern, config] of dataRoutes) {
      const ret = pattern.exec({ pathname });
      if (ret) {
        const request = new Request(
          util.appendUrlParams(url, ret.pathname.groups).toString(),
          req,
        );
        const fetcher = config.get;
        if (util.isFunction(fetcher)) {
          const allFetcher = config.all;
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
            return {
              data: await res.json(),
              cacheTtl: config.cacheTtl,
            };
          }
        }
      }
    }
  }
}

export default {
  async fetch(
    req: Request,
    ctx: Context,
    ssr: { handler: (e: any) => string; htmlTpl: string; css?: string },
  ): Promise<Response> {
    // get data
    const dataRes = await fetchData(req, ctx);
    if (dataRes instanceof Response) {
      return dataRes;
    }
    // ssr
    const headCollection: string[] = [];
    const ssrBody = ssr.handler({
      data: dataRes?.data,
      url: new URL(req.url),
      headCollection,
    });
    const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" });
    if (util.isNumber(dataRes?.cacheTtl)) {
      headers.append("Cache-Control", `public, max-age=${dataRes?.cacheTtl}`);
    } else {
      headers.append("Cache-Control", "public, max-age=0, must-revalidate");
    }
    if (!lolHtmlReady) {
      await init(wasm());
      lolHtmlReady = true;
    }
    const chunks: Uint8Array[] = [];
    const rewriter = new HTMLRewriter("utf8", (chunk: Uint8Array) => {
      chunks.push(chunk);
    });
    rewriter.on("ssr-head", {
      element(el: Element) {
        if (ssr.css) {
          el.before(`<style>${ssr.css}</style>`, { html: true });
        }
        if (dataRes?.data) {
          el.before(`<script id="ssr-data" type="application/json">${JSON.stringify(dataRes?.data)}</script>`, {
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
    rewriter.on("link", {
      element(el: Element) {
        const href = el.getAttribute("href");
        if (href?.startsWith("./")) {
          el.setAttribute("href", href.slice(1));
        }
      },
    });
    rewriter.on("script", {
      element(el: Element) {
        const src = el.getAttribute("src");
        if (src?.startsWith("./")) {
          el.setAttribute("src", src.slice(1));
        }
      },
    });
    rewriter.write(encoder.encode(ssr.htmlTpl));
    rewriter.end();
    return new Response(concat(...chunks), { headers });
  },
};
