import { readableStreamFromReader } from "https://deno.land/std@0.125.0/streams/conversion.ts";
import { content, json } from "./response.ts";
import render from "./render.ts";
import { getContentType } from "../lib/mime.ts";
import { builtinModuleExts } from "../lib/path.ts";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import { serveCode } from "./transformer.ts";
import type { Context, RouteConfig, SSREvent } from "./types.d.ts";

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
    const { pathname, searchParams } = url;

    /* handle '/-/http_localhost_7070/framework/react/mod.ts' */
    if (pathname.startsWith("/-/")) {
      return serveCode(pathname, env);
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
          return serveCode(pathname, env, stat.mtime);
        } else {
          const file = await Deno.open(`.${pathname}`, { read: true });
          return new Response(readableStreamFromReader(file), {
            headers: {
              "Content-Type": getContentType(pathname),
              "Last-Modified": mtimeUTC,
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

    const isDev = env.ALEPH_ENV === "development";
    const ctx: Context = { env, data: {}, config: {} };
    if (util.isFunction(options.fetch)) {
      const resp = options.fetch(req, ctx);
      if (resp instanceof Response) {
        return resp;
      }
    }

    // request page data
    const routes: RouteConfig[] = (self as any).__ALEPH_ROUTES;
    if (util.isArray(routes)) {
      for (const [pattern, load] of routes) {
        const ret = pattern.exec({ pathname });
        if (ret) {
          try {
            const mod = await load();
            if (mod.data && (req.method !== "GET" || mod.component === undefined || req.headers.has("X-Fetch-Data"))) {
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

    return render.fetch(req, ctx, { indexHtml, ssrFn: options.ssr });
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
