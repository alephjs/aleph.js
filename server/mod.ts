import { serve as stdServe, serveTls } from "https://deno.land/std@0.135.0/http/server.ts";
import { readableStreamFromReader } from "https://deno.land/std@0.135.0/streams/conversion.ts";
import { builtinModuleExts } from "../lib/helpers.ts";
import log, { LevelName } from "../lib/log.ts";
import { getContentType } from "../lib/mime.ts";
import type { Routes } from "../lib/route.ts";
import util from "../lib/util.ts";
import { VERSION } from "../version.ts";
import { initModuleLoaders, loadImportMap, loadJSXConfig } from "./config.ts";
import renderer, { type HTMLRewriterHandlers } from "./renderer.ts";
import { content, json } from "./response.ts";
import { importRouteModule, initRoutes } from "./routing.ts";
import clientModuleTransformer from "./transformer.ts";
import type { AlephConfig, FetchHandler, Middleware, MiddlewareCallback, SSRContext } from "./types.ts";

export type ServerOptions = {
  hostname?: string;
  port?: number;
  certFile?: string;
  keyFile?: string;
  hmrWebSocketUrl?: string;
  logLevel?: LevelName;
  config?: AlephConfig;
  middlewares?: Middleware[];
  fetch?: FetchHandler;
  ssr?: (ctx: SSRContext) => string | Promise<string>;
};

export const serve = (options: ServerOptions = {}) => {
  const { config, middlewares, fetch, ssr, logLevel } = options;
  const isDev = Deno.env.get("ALEPH_ENV") === "development";
  const importMapPromise = loadImportMap();
  const jsxConfigPromise = importMapPromise.then((importMap) => loadJSXConfig(importMap));
  const moduleLoadersPromise = importMapPromise.then((importMap) => initModuleLoaders(importMap));
  const routesPromise = config?.routeFiles ? initRoutes(config.routeFiles) : Promise.resolve({ routes: [] } as Routes);
  const buildHashPromise = Promise.all([jsxConfigPromise, importMapPromise]).then(([jsxConfig, importMap]) => {
    const buildArgs = JSON.stringify({ config, jsxConfig, importMap, isDev, VERSION });
    return util.computeHash("sha-1", buildArgs);
  });
  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const { host, pathname } = url;

    if (pathname === "/-/hmr") {
      const { socket, response } = Deno.upgradeWebSocket(req, {});
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "reload" }));
      });
      return response;
    }

    // transform client modules
    if (
      pathname.startsWith("/-/") ||
      (builtinModuleExts.find((ext) => pathname.endsWith(`.${ext}`)) && !pathname.endsWith(".d.ts")) ||
      pathname.endsWith(".css")
    ) {
      const [buildHash, jsxConfig, importMap] = await Promise.all([
        buildHashPromise,
        jsxConfigPromise,
        importMapPromise,
      ]);
      return clientModuleTransformer.fetch(req, {
        isDev,
        importMap,
        jsxConfig,
        buildHash,
        buildTarget: config?.build?.target,
        atomicCSS: config?.atomicCSS,
      });
    }

    // use loader to load modules
    const moduleLoaders = await moduleLoadersPromise;
    const loader = moduleLoaders.find((loader) => loader.test(pathname));
    if (loader) {
      const [buildHash, importMap] = await Promise.all([buildHashPromise, importMapPromise]);
      try {
        const loaded = await loader.load(pathname, { isDev, importMap });
        return clientModuleTransformer.fetch(req, {
          isDev,
          importMap,
          loaded,
          buildHash,
          buildTarget: config?.build?.target,
          atomicCSS: config?.atomicCSS,
        });
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) {
          log.error(err);
          return new Response("Internal Server Error", { status: 500 });
        }
      }
    }

    // serve static files
    try {
      let filePath = `.${pathname}`;
      let stat = await Deno.lstat(filePath);
      if (stat.isDirectory && pathname !== "/") {
        filePath = `${util.trimSuffix(filePath, "/")}/index.html`;
        stat = await Deno.lstat(filePath);
      }
      if (stat.isFile) {
        const { mtime } = stat;
        const etag = mtime ? mtime.getTime().toString(16) + "-" + stat.size.toString(16) : null;
        if (etag && req.headers.get("If-None-Match") === etag) {
          return new Response(null, { status: 304 });
        }
        const file = await Deno.open(filePath, { read: true });
        const headers = new Headers({ "Content-Type": getContentType(pathname) });
        if (mtime) {
          headers.set("Etag", etag!);
          headers.set("Last-Modified", mtime.toUTCString());
        }
        return new Response(readableStreamFromReader(file), { headers });
      }
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) {
        log.error(err);
        return new Response("Internal Server Error", { status: 500 });
      }
    }

    // use fetch handler if available
    if (typeof fetch === "function") {
      let res = fetch(req);
      if (res instanceof Promise) {
        res = await res;
      }
      if (res instanceof Response) {
        return res;
      }
    }

    const customHTMLRewriter = new Map<string, HTMLRewriterHandlers>();
    const ctx = {
      params: {},
      HTMLRewriter: {
        on: (selector: string, handlers: HTMLRewriterHandlers) => {
          customHTMLRewriter.set(selector, handlers);
        },
      },
    };

    // use middlewares
    if (Array.isArray(middlewares) && middlewares.length > 0) {
      const callbacks: MiddlewareCallback[] = [];
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
          if (typeof res === "function") {
            callbacks.push(res);
          }
        }
      }
      for (const callback of callbacks) {
        await callback();
      }
    }

    // request data
    const routes: Routes = Reflect.get(globalThis, "__ALEPH_ROUTES") || await routesPromise;
    if (routes.routes.length > 0) {
      for (const [pattern, { filename }] of routes.routes) {
        const ret = pattern.exec({ host, pathname });
        if (ret) {
          try {
            const mod = await importRouteModule(filename);
            const dataConfig: Record<string, unknown> = util.isPlainObject(mod.data) ? mod.data : {};
            if (
              req.method !== "GET" || mod.default === undefined || req.headers.get("Accept") === "application/json" ||
              !req.headers.get("Accept")?.includes("html")
            ) {
              const fetcher = dataConfig[req.method.toLowerCase()];
              if (typeof fetcher === "function") {
                return fetcher(req, { ...ctx, params: ret.pathname.groups });
              }
              return new Response("Method not allowed", { status: 405 });
            }
          } catch (err) {
            if (err.stack) {
              log.error(err.stack);
            }
            const status = util.isUint(err.status || err.code) ? err.status || err.code : 500;
            return json({ ...err, message: err.message, status }, { status });
          }
        }
      }
    }

    // don't render those special asset files
    switch (pathname) {
      case "/favicon.ico":
      case "/robots.txt":
        return new Response("Not found", { status: 404 });
    }

    // load the `index.html`
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
          log.error("read index.html:", err.message);
          return new Response("Internal Server Error", { status: 500 });
        }
      }
    }

    // cache indexHtml to global(memory) in production mode
    if (!isDev) {
      Reflect.set(globalThis, "__ALEPH_INDEX_HTML", indexHtml);
    }

    // no root `index.html` found
    if (indexHtml === null) {
      return new Response("Not Found", { status: 404 });
    }

    if (isDev && options.hmrWebSocketUrl) {
      customHTMLRewriter.set("head", {
        element(el) {
          el.append(`<script>window.__hmrWebSocketUrl=${JSON.stringify(options.hmrWebSocketUrl)};</script>`, {
            html: true,
          });
        },
      });
    }

    // render html
    return renderer.fetch(req, ctx, {
      indexHtml,
      routes,
      customHTMLRewriter,
      isDev,
      ssr,
    });
  };

  // inject navigator browser polyfill to fix some ssr errors
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

  // set log level
  if (logLevel) {
    log.setLevel(logLevel);
  }

  // inject global `__ALEPH_CONFIG`
  Reflect.set(globalThis, "__ALEPH_CONFIG", Object.assign({}, config));

  const { hostname, port = 8080, certFile, keyFile } = options;
  if (Deno.env.get("ALEPH_CLI")) {
    Reflect.set(globalThis, "__ALEPH_SERVER", { hostname, port, certFile, keyFile, handler });
  } else {
    if (certFile && keyFile) {
      serveTls(handler, { hostname, port, certFile, keyFile });
    } else {
      stdServe(handler, { hostname, port });
    }
    log.info(`Server ready on http://localhost:${port}`);
  }
};

export { content, json };
