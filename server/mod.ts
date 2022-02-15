import { readableStreamFromReader } from "https://deno.land/std@0.125.0/streams/conversion.ts";
import { getContentType } from "../lib/mime.ts";
import { builtinModuleExts } from "../lib/path.ts";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import { getRoutes } from "./routing.ts";
import { content, json } from "./response.ts";
import ssr from "./ssr.ts";
import { fetchClientModule } from "./transformer.ts";
import type { Fetcher, Middleware, SSREvent } from "../types.d.ts";

export type ServerOptions = {
  routes?: string;
  jsxMagic?: boolean;
  middlewares?: Middleware[];
  fetch?: Fetcher;
  ssr?: (e: SSREvent) => string | null | undefined;
};

export const serve = (options: ServerOptions = {}) => {
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
    userAgent: `Deno/${Deno.version?.deno || "deploy"}`,
    vendor: "Deno Land Inc.",
  });

  const { jsxMagic = true } = options;

  const handler = async (req: Request) => {
    const url = new URL(req.url);
    const { pathname, searchParams } = url;
    const isDev = Deno.env.get("ALEPH_ENV") === "development";

    /* handle '/-/http_localhost_7070/framework/react/mod.ts' */
    if (pathname.startsWith("/-/")) {
      return fetchClientModule(pathname, { isDev, jsxMagic });
    }

    try {
      const stat = await Deno.lstat(`.${pathname}`);
      if (stat.isFile && stat.mtime) {
        const mtimeUTC = stat.mtime.toUTCString();
        if (req.headers.get("If-Modified-Since") === mtimeUTC) {
          return new Response(null, { status: 304 });
        }
        if (
          builtinModuleExts.find((ext) => pathname.endsWith(`.${ext}`)) ||
          searchParams.has("module")
        ) {
          return fetchClientModule(pathname, { isDev, jsxMagic, mtime: stat.mtime });
        } else {
          const file = await Deno.open(`.${pathname}`, { read: true });
          return new Response(readableStreamFromReader(file), {
            headers: {
              "Content-Type": getContentType(pathname),
              "Last-Modified": mtimeUTC,
              "Cache-Control": "public, max-age=0, must-revalidate",
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

    const ctx: Record<string | symbol, any> = {};
    if (util.isArray(options.middlewares)) {
      for (const mw of options.middlewares) {
        let fetcher = mw;
        if (util.isPlainObject<{ fetch: Fetcher }>(mw)) {
          fetcher = mw.fetch;
        }
        if (util.isFunction(fetcher)) {
          let res = fetcher(req, ctx);
          if (res instanceof Promise) {
            res = await res;
          }
          if (res instanceof Response) {
            return res;
          }
        }
      }
    }
    if (util.isFunction(options.fetch)) {
      let res = options.fetch(req, ctx);
      if (res instanceof Promise) {
        res = await res;
      }
      if (res instanceof Response) {
        return res;
      }
    }

    // request page data
    const routes = options.routes ? await getRoutes(options.routes) : [];
    if (routes.length > 0) {
      for (const [pattern, load] of routes) {
        const ret = pattern.exec({ pathname });
        if (ret) {
          try {
            const mod = await load();
            if (
              mod.data &&
              (req.method !== "GET" || mod.default === undefined || req.headers.has("X-Fetch-Data"))
            ) {
              const request = new Request(util.appendUrlParams(url, ret.pathname.groups).toString(), req);
              const fetcher = mod.data[req.method.toLowerCase()];
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
                return fetcher(request, ctx);
              }
              return new Response("Method not allowed", { status: 405 });
            }
          } catch (err) {
            log.error(err.stack);
            return new Response(isDev ? err.message.split("\n")[0] : "Internal Server Error", { status: 500 });
          }
        }
      }
    }

    let indexHtml: string | null | undefined = (globalThis as any).__ALEPH_INDEX_HTML;
    if (indexHtml === undefined) {
      try {
        indexHtml = await Deno.readTextFile("./index.html");
        // since `lol-html` can't handle `<ssr-body />` correctly then replace it to `<ssr-body></ssr-body>`
        indexHtml = indexHtml.replace(
          /<ssr-(head|body)[ \/]*> *(<\/ssr-(head|body)>)?/g,
          "<ssr-$1></ssr-$1>",
        );
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
          indexHtml = null;
        } else {
          log.error(err);
          return new Response(isDev ? err.message.split("\n")[0] : "Internal Server Error", { status: 500 });
        }
      }
    }

    // cache indexHtml to global(memory) in production env
    if (!isDev) {
      (globalThis as any).__ALEPH_INDEX_HTML = indexHtml;
    }

    if (indexHtml === null) {
      return new Response("Not Found", { status: 404 });
    }

    return ssr.fetch(req, ctx, { indexHtml, ssrFn: options.ssr, routes });
  };

  if (Deno.env.get("DENO_DEPLOYMENT_ID")) {
    // support deno deploy
    self.addEventListener("fetch", (e: any) => {
      e.respondWith(handler(e.request));
    });
  } else {
    Object.assign(globalThis, { __ALEPH_SERVER_HANDLER: handler });
  }
};

export { content, json };
