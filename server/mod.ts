import { readableStreamFromReader } from "https://deno.land/std@0.125.0/streams/conversion.ts";
import { content, json } from "./response.ts";
import ssr from "./ssr.ts";
import { getContentType } from "../lib/mime.ts";
import { builtinModuleExts } from "../lib/path.ts";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import { serveCode } from "./transformer.ts";

export type ServerOptions = {
  fetch?: (request: Request, context: Context) => Promise<Response | void> | Response | void;
  ssr?: (e: SSREvent) => string;
};

export const serve = (options: ServerOptions) => {
  // inject browser navigator polyfill
  Object.assign(globalThis.navigator, {
    connection: {
      downlink: 10,
      effectiveType: "4g",
      onchange: null,
      rtt: 50,
      saveData: false,
    },
    cookieEnabled: false,
    language: "en",
    languages: ["en"],
    onLine: true,
    userAgent: `Deno/${Deno.version.deno}`,
    vendor: "Deno Land Inc.",
  });

  const handler = async (req: Request, env: Record<string, string>) => {
    const url = new URL(req.url);
    const { pathname } = url;

    try {
      const stat = await Deno.lstat(`.${pathname}`);
      if (stat.isFile && stat.mtime) {
        const ifModifiedSince = req.headers.get("If-Modified-Since");
        if (ifModifiedSince) {
          const ifModifiedSinceDate = new Date(ifModifiedSince);
          if (ifModifiedSinceDate.getTime() === stat.mtime.getTime()) {
            return new Response(null, { status: 304 });
          }
        }
        if (builtinModuleExts.find((ext) => pathname.endsWith(`.${ext}`))) {
          return serveCode(pathname, stat.mtime);
        } else {
          const file = await Deno.open(`.${pathname}`, { read: true });
          return new Response(readableStreamFromReader(file), {
            headers: {
              "Content-Type": getContentType(pathname),
              "Last-Modified": stat.mtime.toUTCString(),
            },
          });
        }
      }
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) {
        log.error(err);
        return new Response("Internal Server Error", { status: 500 });
      }
    }

    switch (pathname) {
      case "/favicon.ico":
      case "/robots.txt":
        return new Response("Not found", { status: 404 });
    }

    const ctx: Context = { env, data: {} };
    if (util.isFunction(options.fetch)) {
      const resp = options.fetch(req, ctx);
      if (resp instanceof Response) {
        return resp;
      }
    }

    // request page data
    const dataRoutes: [URLPattern, Record<string, any>, boolean][] = (self as any).__ALEPH_DATA_ROUTES;
    if (util.isArray(dataRoutes)) {
      for (const [pattern, config, hasCompoment] of dataRoutes) {
        const ret = pattern.exec({ pathname });
        if (ret) {
          if (req.method !== "GET" || req.headers.has("X-Fetch-Data") || !hasCompoment) {
            const request = new Request(util.appendUrlParams(url, ret.pathname.groups).toString(), req);
            const fetcher = config[req.method.toLowerCase()];
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
              return fetcher(request, ctx);
            }
            return new Response("Method not allowed", { status: 405 });
          }
        }
      }
    }

    let indexHtml: string | null | undefined = (globalThis as any).__ALEPH_INDEX_HTML;
    if (indexHtml === undefined) {
      try {
        indexHtml = await Deno.readTextFile("./index.html");
        // since HTMLRewriter can't handle `<ssr-body />` correctly replace it to `<ssr-body></ssr-body>`
        indexHtml = indexHtml.replace(
          /<ssr-(head|body)[ \/]*> *(<\/ssr-(head|body)>)?/g,
          "<ssr-$1></ssr-$1>",
        );
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
          indexHtml = null;
        } else {
          log.error(err);
          return new Response("Internal Server Error", { status: 500 });
        }
      }
    }

    if (Deno.env.get("ALEPH_ENV") !== "development") {
      (globalThis as any).__ALEPH_INDEX_HTML = indexHtml;
    }

    if (indexHtml === null) {
      return new Response("Not Found", { status: 404 });
    }

    // request ssr
    if (util.isFunction(options.ssr)) {
      return ssr.fetch(req, ctx, { handler: options.ssr, htmlTpl: indexHtml });
    }

    // fallback to the index html
    return content(indexHtml, "text/html; charset=utf-8");
  };

  if (Deno.env.get("DENO_DEPLOYMENT_ID")) {
    // support deno deploy
    self.addEventListener("fetch", (e: any) => {
      e.respondWith(handler(e.request, Deno.env.toObject()));
    });
  } else {
    Object.assign(globalThis, { __ALEPH_SERVER_HANDLER: handler });
  }
};

export { content, json };
