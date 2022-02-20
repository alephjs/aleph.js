import { readableStreamFromReader } from "https://deno.land/std@0.125.0/streams/conversion.ts";
import { getContentType } from "../lib/mime.ts";
import { builtinModuleExts } from "../lib/path.ts";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import type { ServerOptions } from "../types.d.ts";
import { VERSION } from "../version.ts";
import { loadImportMap, loadJSXConfig } from "./config.ts";
import { DependencyGraph } from "./graph.ts";
import { initRoutes } from "./routing.ts";
import { content, json } from "./response.ts";
import renderer from "./renderer.ts";
import { clientModuleTransformer } from "./transformer.ts";

export const serve = (options: ServerOptions = {}) => {
  const { config, middlewares, fetch, ssr } = options;
  const isDev = Deno.env.get("ALEPH_ENV") === "development";
  const jsxConfigPromise = loadJSXConfig();
  const importMapPromise = loadImportMap();
  const buildTarget = config?.build?.target ?? (isDev ? "es2022" : "es2015");
  const buildArgsHashPromise = Promise.all([jsxConfigPromise, importMapPromise]).then(
    async ([jsxConfig, importMap]) => {
      const buildArgs = JSON.stringify({ config, jsxConfig, importMap, isDev, VERSION });
      return util.toHex(await crypto.subtle.digest("sha-1", (new TextEncoder()).encode(buildArgs)));
    },
  );
  const routesPromise = config?.routeFiles ? initRoutes(config.routeFiles) : Promise.resolve([]);
  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const { pathname } = url;

    if (
      pathname.startsWith("/-/") ||
      builtinModuleExts.find((ext) => pathname.endsWith(`.${ext}`)) ||
      pathname.endsWith(".css")
    ) {
      const [buildArgsHash, jsxConfig, importMap] = await Promise.all([
        buildArgsHashPromise,
        jsxConfigPromise,
        importMapPromise,
      ]);
      return clientModuleTransformer.fetch(req, {
        isDev,
        buildTarget,
        buildArgsHash,
        importMap,
        jsxConfig,
        atomicCSS: config?.atomicCSS,
      });
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

    const ctx: Record<string, unknown> = {};

    // use middlewares
    if (Array.isArray(middlewares)) {
      for (const mw of middlewares) {
        const handler = mw.fetch;
        if (typeof handler === "function") {
          let res = handler(req, ctx);
          if (res instanceof Promise) {
            res = await res;
          }
          if (res instanceof Response) {
            return res;
          }
        }
      }
    }

    // use fetch handler if available
    if (typeof fetch === "function") {
      let res = fetch(req, ctx);
      if (res instanceof Promise) {
        res = await res;
      }
      if (res instanceof Response) {
        return res;
      }
    }

    // request page data
    const routes = await routesPromise;
    if (routes.length > 0) {
      for (const [pattern, load] of routes) {
        const ret = pattern.exec({ pathname });
        if (ret) {
          try {
            const mod = await load();
            const dataConfig: Record<string, unknown> = util.isPlainObject(mod.data) ? mod.data : {};
            if (req.method !== "GET" || mod.default === undefined || req.headers.has("X-Fetch-Data")) {
              const fetcher = dataConfig[req.method.toLowerCase()];
              if (typeof fetcher === "function") {
                const request = new Request(util.appendUrlParams(url, ret.pathname.groups).toString(), req);
                const allFetcher = dataConfig.all;
                if (typeof allFetcher === "function") {
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
            if (err.stack) {
              log.error(err.stack);
            }
            return new Response(
              isDev || (typeof err.status === "number" && err.status < 500)
                ? err.message || "Server Error"
                : "Internal Server Error",
              {
                status: err.status || 500,
              },
            );
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

    let indexHtml: string | null | undefined = Reflect.get(globalThis, "__ALEPH_INDEX_HTML");
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
      Reflect.set(globalThis, "__ALEPH_INDEX_HTML", indexHtml);
    }

    if (indexHtml === null) {
      return new Response("Not Found", { status: 404 });
    }

    return renderer.fetch(req, ctx, { indexHtml, routes, ssrHandler: ssr, isDev });
  };

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

  // support deno deploy
  if (Deno.env.get("DENO_DEPLOYMENT_ID")) {
    self.addEventListener("fetch", (e) => {
      // deno-lint-ignore ban-ts-comment
      // @ts-ignore
      e.respondWith(handler(e.request));
    });
    return;
  }

  Reflect.set(globalThis, "__ALEPH_clientDependencyGraph", new DependencyGraph());
  Reflect.set(globalThis, "__ALEPH_serverDependencyGraph", new DependencyGraph());
  Reflect.set(globalThis, "__ALEPH_CONFIG", Object.assign({}, config));
  Reflect.set(globalThis, "__ALEPH_SERVER_HANDLER", handler);
};

export { content, json };
