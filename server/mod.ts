import { serve as stdServe, type ServeInit, serveTls } from "https://deno.land/std@0.136.0/http/server.ts";
import { readableStreamFromReader } from "https://deno.land/std@0.136.0/streams/conversion.ts";
import log, { LevelName } from "../lib/log.ts";
import { getContentType } from "../lib/mime.ts";
import type { Routes } from "../lib/route.ts";
import util from "../lib/util.ts";
import { VERSION } from "../version.ts";
import { initModuleLoaders, loadImportMap, loadJSXConfig } from "./config.ts";
import { loadAndFixIndexHtml } from "./html.ts";
import type { HTMLRewriterHandlers, SSR } from "./renderer.ts";
import renderer from "./renderer.ts";
import { content, type CookieOptions, json, setCookieHeader } from "./response.ts";
import { importRouteModule, initRoutes, revive } from "./routing.ts";
import clientModuleTransformer from "./transformer.ts";
import type { AlephConfig, FetchHandler, Middleware, MiddlewareCallback } from "./types.ts";

export type ServerOptions = ServeInit & {
  certFile?: string;
  keyFile?: string;
  logLevel?: LevelName;
  hmrWebSocketUrl?: string;
  config?: AlephConfig;
  middlewares?: Middleware[];
  fetch?: FetchHandler;
  ssr?: SSR;
};

export const serve = (options: ServerOptions = {}) => {
  const { config, middlewares, fetch, ssr, logLevel } = options;
  const isDev = Deno.env.get("ALEPH_ENV") === "development";
  const importMapPromise = loadImportMap();
  const jsxConfigPromise = importMapPromise.then((importMap) => loadJSXConfig(importMap));
  const moduleLoadersPromise = importMapPromise.then((importMap) => initModuleLoaders(importMap));
  const routesPromise = config?.routes ? initRoutes(config.routes) : Promise.resolve({ routes: [] } as Routes);
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
    if (clientModuleTransformer.test(pathname)) {
      const [buildHash, jsxConfig, importMap] = await Promise.all([
        buildHashPromise,
        jsxConfigPromise,
        importMapPromise,
      ]);
      return clientModuleTransformer.fetch(req, {
        importMap,
        jsxConfig,
        buildHash,
        buildTarget: config?.build?.target,
        isDev,
      });
    }

    // use loader to load modules
    const moduleLoaders = await moduleLoadersPromise;
    const loader = moduleLoaders.find((loader) => loader.test(pathname));
    if (loader) {
      const [buildHash, jsxConfig, importMap] = await Promise.all([
        buildHashPromise,
        jsxConfigPromise,
        importMapPromise,
      ]);
      try {
        const loaded = await loader.load(pathname, { isDev, importMap });
        return clientModuleTransformer.fetch(req, {
          loaded,
          importMap,
          jsxConfig,
          buildHash,
          buildTarget: config?.build?.target,
          isDev,
        });
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) {
          log.error(err);
          return new Response(err.message, { status: 500 });
        }
      }
    }

    // serve static files
    const contentType = getContentType(pathname);
    if (!pathname.startsWith("/.") && contentType !== "application/octet-stream") {
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
          const headers = new Headers({ "Content-Type": contentType });
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

    let cookies: Map<string, string> | null = null;

    const customHTMLRewriter = new Map<string, HTMLRewriterHandlers>();
    const ctx = {
      params: {},
      headers: new Headers(),
      cookies: {
        get: (name: string) => {
          if (cookies === null) {
            cookies = new Map<string, string>();
            const cookieHeader = req.headers.get("Cookie");
            if (cookieHeader) {
              for (const cookie of cookieHeader.split(";")) {
                const [key, value] = util.splitBy(cookie, "=");
                cookies.set(key.trim(), value);
              }
            }
          }
          return cookies.get(name);
        },
        set: (name: string, value: string, options?: CookieOptions) => {
          ctx.headers.set("Set-Cookie", setCookieHeader(name, value, options));
        },
        delete: (name: string, options?: CookieOptions) => {
          ctx.headers.set("Set-Cookie", setCookieHeader(name, "", { ...options, expires: new Date(0) }));
        },
      },
      htmlRewriter: {
        on: (selector: string, handlers: HTMLRewriterHandlers) => {
          customHTMLRewriter.set(selector, handlers);
        },
      },
      redirect(url: string | URL, code?: number) {
        const headers = new Headers(ctx.headers);
        headers.set("Location", url.toString());
        return new Response(null, { status: code || 302, headers });
      },
      json: (data: unknown, init?: ResponseInit): Response => {
        let hasCustomHeaders = false;
        const headers = new Headers(init?.headers);
        ctx.headers.forEach((value, name) => {
          headers.set(name, value);
          hasCustomHeaders = true;
        });
        if (!hasCustomHeaders) {
          return json(data, init);
        }
        return json(data, { ...init, headers });
      },
      content: (body: BodyInit, init?: ResponseInit): Response => {
        let hasCustomHeaders = false;
        const headers = new Headers(init?.headers);
        ctx.headers.forEach((value, name) => {
          headers.set(name, value);
          hasCustomHeaders = true;
        });
        if (!hasCustomHeaders) {
          return content(body, init);
        }
        return content(body, { ...init, headers });
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
            const status: number = util.isUint(err.status || err.code) ? err.status || err.code : 500;
            return ctx.json({ ...err, message: err.message, status }, { status });
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
    let indexHtml: Uint8Array | null | undefined = Reflect.get(globalThis, "__ALEPH_INDEX_HTML");
    if (indexHtml === undefined) {
      try {
        indexHtml = await loadAndFixIndexHtml(isDev, typeof ssr === "function" ? {} : ssr);
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
          indexHtml = null;
        } else {
          log.error("read index.html:", err);
          return new Response("Internal Server Error", { status: 500 });
        }
      }
    }
    // cache `index.html` to memory
    Reflect.set(globalThis, "__ALEPH_INDEX_HTML", indexHtml);

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

  // delete previous `__UNO_GENERATOR`
  Reflect.deleteProperty(globalThis, "__UNO_GENERATOR");

  const { hostname, port = 8080, certFile, keyFile, signal } = options;
  if (Deno.env.get("ALEPH_CLI")) {
    Reflect.set(globalThis, "__ALEPH_SERVER", { hostname, port, certFile, keyFile, handler, signal });
  } else {
    if (certFile && keyFile) {
      serveTls(handler, { hostname, port, certFile, keyFile, signal });
    } else {
      stdServe(handler, { hostname, port, signal });
    }
    log.info(`Server ready on http://localhost:${port}`);
  }
};

export { content, json, revive, setCookieHeader };
