import { readableStreamFromReader } from "https://deno.land/std@0.125.0/streams/conversion.ts";
import { getContentType } from "../lib/mime.ts";
import { builtinModuleExts } from "../lib/path.ts";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import { getRoutes } from "./routing.ts";
import { content, json } from "./response.ts";
import renderer from "./renderer.ts";
import { clientModuleTransformer } from "./transformer.ts";
import type { AlephConfig, Fetcher, Middleware, SSREvent } from "../types.d.ts";

export type ServerOptions = {
  config?: AlephConfig;
  middlewares?: Middleware[];
  fetch?: Fetcher;
  ssr?: (e: SSREvent) => string | null | undefined;
};

export const serve = ({ config, middlewares, fetch, ssr }: ServerOptions = {}) => {
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

  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const { pathname } = url;
    const isDev = Deno.env.get("ALEPH_ENV") === "development";

    if (
      pathname.startsWith("/-/") ||
      builtinModuleExts.find((ext) => pathname.endsWith(`.${ext}`)) ||
      pathname.endsWith(".css")
    ) {
      return clientModuleTransformer.fetch(req, { isDev, windicss: config?.windicss });
    }

    try {
      let filePath = `.${pathname}`;
      let stat = await Deno.lstat(filePath);
      if (stat.isDirectory && pathname !== "/") {
        filePath = `${util.trimSuffix(filePath, "/")}/index.html`;
        stat = await Deno.lstat(filePath);
      }
      if (stat.isFile && stat.mtime) {
        const etag = stat.mtime.getTime().toString(16) + "-" + stat.size.toString(16);
        if (req.headers.get("If-None-Match") === etag) {
          return new Response(null, { status: 304 });
        }
        const file = await Deno.open(`.${pathname}`, { read: true });
        return new Response(readableStreamFromReader(file), {
          headers: {
            "Content-Type": getContentType(pathname),
            "Etag": etag,
            "Last-Modified": stat.mtime.toUTCString(),
            "Cache-Control": "public, max-age=0, must-revalidate",
          },
        });
      }
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) {
        log.error(err);
        return new Response("Internal Server Error", { status: 500 });
      }
    }

    const ctx: Record<string | symbol, any> = {};
    if (Array.isArray(middlewares)) {
      for (const mw of middlewares) {
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
    if (util.isFunction(fetch)) {
      let res = fetch(req, ctx);
      if (res instanceof Promise) {
        res = await res;
      }
      if (res instanceof Response) {
        return res;
      }
    }

    // request page data
    const routes = config?.routeFiles ? await getRoutes(config.routeFiles) : [];
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

    // don't render this special asset files
    switch (pathname) {
      case "/favicon.ico":
      case "/robots.txt":
        return new Response("Not found", { status: 404 });
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

    return renderer.fetch(req, ctx, { indexHtml, ssrFn: ssr, routes });
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
