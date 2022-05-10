import type { ConnInfo, ServeInit } from "https://deno.land/std@0.136.0/http/server.ts";
import { serve as stdServe, serveTls } from "https://deno.land/std@0.136.0/http/server.ts";
import { readableStreamFromReader } from "https://deno.land/std@0.136.0/streams/conversion.ts";
import FetchError from "../framework/core/fetch_error.ts";
import type { RouteRecord } from "../framework/core/route.ts";
import log, { LevelName } from "../lib/log.ts";
import { getContentType } from "../lib/mime.ts";
import util from "../lib/util.ts";
import { ErrorCallback, generateErrorHtml } from "./error.ts";
import { DependencyGraph } from "./graph.ts";
import { getDeploymentId, initModuleLoaders, loadImportMap, loadJSXConfig, regFullVersion } from "./helpers.ts";
import { type HTMLRewriterHandlers, loadAndFixIndexHtml } from "./html.ts";
import renderer, { type SSR } from "./renderer.ts";
import { content, type CookieOptions, json, setCookieHeader } from "./response.ts";
import { importRouteModule, initRoutes, revive } from "./routing.ts";
import clientModuleTransformer from "./transformer.ts";
import type { AlephConfig, FetchHandler, Middleware } from "./types.ts";

export type ServerOptions = Omit<ServeInit, "onError"> & {
  certFile?: string;
  keyFile?: string;
  logLevel?: LevelName;
  hmrWebSocketUrl?: string;
  middlewares?: Middleware[];
  fetch?: FetchHandler;
  ssr?: SSR;
  onError?: ErrorCallback;
} & AlephConfig;

export const serve = (options: ServerOptions = {}) => {
  const { routes, build, unocss, middlewares, fetch, ssr, logLevel, onError } = options;
  const isDev = Deno.env.get("ALEPH_ENV") === "development";
  const importMapPromise = loadImportMap();
  const jsxConfigPromise = importMapPromise.then(loadJSXConfig);
  const moduleLoadersPromise = importMapPromise.then(initModuleLoaders);
  const routesPromise = routes ? initRoutes(routes) : Promise.resolve({ routes: [] });
  const handler = async (req: Request, connInfo: ConnInfo): Promise<Response> => {
    const url = new URL(req.url);
    const { host, pathname, searchParams } = url;

    // close the hot-reloading websocket connection and tell the client to reload
    if (pathname === "/-/hmr") {
      const { socket, response } = Deno.upgradeWebSocket(req, {});
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "reload" }));
        setTimeout(() => {
          socket.close();
        }, 50);
      });
      return response;
    }

    // transform client modules
    if (clientModuleTransformer.test(pathname)) {
      try {
        const [jsxConfig, importMap] = await Promise.all([
          jsxConfigPromise,
          importMapPromise,
        ]);
        return await clientModuleTransformer.fetch(req, {
          importMap,
          jsxConfig,
          buildTarget: build?.target,
          isDev,
        });
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) {
          log.error(err);
          return onError?.(err, { by: "transplie", url: req.url }) ??
            new Response(generateErrorHtml(err.stack ?? err.message), {
              status: 500,
              headers: [["Content-Type", "text/html"]],
            });
        }
      }
    }

    // use loader to load modules
    const moduleLoaders = await moduleLoadersPromise;
    const loader = moduleLoaders.find((loader) => loader.test(pathname));
    if (loader) {
      try {
        const [jsxConfig, importMap] = await Promise.all([
          jsxConfigPromise,
          importMapPromise,
        ]);
        const loaded = await loader.load(pathname, { isDev, importMap });
        return await clientModuleTransformer.fetch(req, {
          loaded,
          importMap,
          jsxConfig,
          buildTarget: build?.target,
          isDev,
        });
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) {
          log.error(err);
          return onError?.(err, { by: "transplie", url: req.url }) ??
            new Response(generateErrorHtml(err.stack ?? err.message), {
              status: 500,
              headers: [["Content-Type", "text/html"]],
            });
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
          const headers = new Headers({ "Content-Type": contentType });
          const deployId = getDeploymentId();
          let etag: string | null = null;
          if (deployId) {
            etag = `W/${btoa(pathname).replace(/[^a-z0-9]/g, "")}-${deployId}`;
          } else {
            const { mtime, size } = stat;
            if (mtime) {
              etag = `W/${mtime.getTime().toString(16)}-${size.toString(16)}`;
              headers.append("Last-Modified", new Date(mtime).toUTCString());
            }
          }
          if (etag) {
            if (req.headers.get("If-None-Match") === etag) {
              return new Response(null, { status: 304 });
            }
            headers.append("ETag", etag);
          }
          if (searchParams.get("v") || regFullVersion.test(pathname)) {
            headers.append("Cache-Control", "public, max-age=31536000, immutable");
          }
          const file = await Deno.open(filePath, { read: true });
          return new Response(readableStreamFromReader(file), { headers });
        }
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) {
          log.error(err);
          return onError?.(err, { by: "fs", url: req.url }) ??
            new Response(generateErrorHtml(err.stack ?? err.message), {
              status: 500,
              headers: [["Content-Type", "text/html"]],
            });
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

    // create context object
    const customHTMLRewriter = new Map<string, HTMLRewriterHandlers>();
    const ctx = {
      connInfo,
      params: {},
      headers: new Headers(),
      cookies: {
        _cookies: null as Map<string, string> | null,
        get(name: string) {
          if (this._cookies === null) {
            this._cookies = new Map<string, string>();
            const cookieHeader = req.headers.get("Cookie");
            if (cookieHeader) {
              for (const cookie of cookieHeader.split(";")) {
                const [key, value] = util.splitBy(cookie, "=");
                this._cookies.set(key.trim(), value);
              }
            }
          }
          return this._cookies.get(name);
        },
        set(name: string, value: string, options?: CookieOptions) {
          this._cookies?.set(name, value);
          ctx.headers.set("Set-Cookie", setCookieHeader(name, value, options));
        },
        delete(name: string, options?: CookieOptions) {
          this._cookies?.delete(name);
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
        let headers: Headers | null = null;
        ctx.headers.forEach((value, name) => {
          if (!headers) {
            headers = new Headers(init?.headers);
          }
          headers.set(name, value);
        });
        if (!headers) {
          return json(data, init);
        }
        return json(data, { ...init, headers });
      },
      content: (body: BodyInit, init?: ResponseInit): Response => {
        let headers: Headers | null = null;
        ctx.headers.forEach((value, name) => {
          if (!headers) {
            headers = new Headers(init?.headers);
          }
          headers.set(name, value);
        });
        if (!headers) {
          return content(body, init);
        }
        return content(body, { ...init, headers });
      },
    };

    // use middlewares
    if (Array.isArray(middlewares) && middlewares.length > 0) {
      for (const mw of middlewares) {
        try {
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
              setTimeout(res, 0);
            }
          }
        } catch (err) {
          return onError?.(err, { by: "middleware", url: req.url, context: ctx }) ??
            new Response(generateErrorHtml(err.stack ?? err.message), {
              status: 500,
              headers: [["Content-Type", "text/html"]],
            });
        }
      }
    }

    // request route api
    const routes: RouteRecord = Reflect.get(globalThis, "__ALEPH_ROUTES") || await routesPromise;
    if (routes.routes.length > 0) {
      for (const [pattern, { filename }] of routes.routes) {
        const ret = pattern.exec({ host, pathname });
        const accept = req.headers.get("Accept");
        const fromFetchApi = accept === "application/json" || !accept?.includes("html");
        if (ret) {
          try {
            const { method } = req;
            const mod = await importRouteModule(filename);
            const dataConfig = util.isPlainObject(mod.data) ? mod.data : mod;
            if (method !== "GET" || mod.default === undefined || fromFetchApi) {
              Object.assign(ctx.params, ret.pathname.groups);
              const anyFetcher = dataConfig.any ?? dataConfig.ANY;
              if (typeof anyFetcher === "function") {
                const res = await anyFetcher(req, ctx);
                if (res instanceof Response) {
                  return res;
                }
              }
              const fetcher = dataConfig[method.toLowerCase()] ?? dataConfig[method];
              if (typeof fetcher === "function") {
                const res = await fetcher(req, ctx);
                if (res instanceof Response) {
                  if (res.status >= 300 && fromFetchApi) {
                    const err = await FetchError.fromResponse(res);
                    return ctx.json({ ...err }, { status: err.status >= 400 ? err.status : 501 });
                  }
                  return res;
                }
                if (
                  typeof res === "string" || res instanceof ArrayBuffer || res instanceof ReadableStream
                ) {
                  return ctx.content(res);
                }
                if (res instanceof Blob || res instanceof File) {
                  return ctx.content(res, { headers: { "Content-Type": res.type } });
                }
                if (util.isPlainObject(res) || Array.isArray(res) || res === null) {
                  return ctx.json(res);
                }
                return new Response(null, { headers: ctx.headers });
              }
              return new Response("Method not allowed", { status: 405 });
            }
          } catch (err) {
            const res = onError?.(err, { by: "route-api", url: req.url, context: ctx });
            if (res instanceof Response) {
              return res;
            }
            if (err instanceof Response) {
              return err;
            }
            if (err instanceof Error || typeof err === "string") {
              log.error(err);
            }
            const status: number = util.isUint(err.status || err.code) ? err.status || err.code : 500;
            return ctx.json({
              ...err,
              message: err.message || String(err),
              status,
            }, {
              status: status >= 400 ? status : 501,
            });
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
        indexHtml = await loadAndFixIndexHtml({
          isDev,
          importMap: await importMapPromise,
          ssr: typeof ssr === "function" ? {} : ssr,
          hmrWebSocketUrl: options.hmrWebSocketUrl,
        });
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
          indexHtml = null;
        } else {
          log.error("read index.html:", err);
          return onError?.(err, { by: "fs", url: req.url }) ??
            new Response(generateErrorHtml(err.stack ?? err.message), {
              status: 500,
              headers: [["Content-Type", "text/html"]],
            });
        }
      }
    }
    // cache `index.html` to memory
    Reflect.set(globalThis, "__ALEPH_INDEX_HTML", indexHtml);

    // no root `index.html` found
    if (indexHtml === null) {
      return new Response("Not Found", { status: 404 });
    }

    // render html
    return renderer.fetch(req, ctx, {
      indexHtml,
      routes,
      customHTMLRewriter,
      isDev,
      ssr,
      onError,
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

  // set log level if specified
  if (logLevel) {
    log.setLevel(logLevel);
  }

  // inject global objects
  Reflect.set(globalThis, "__ALEPH_CONFIG", { build, routes, unocss });
  Reflect.set(globalThis, "clientDependencyGraph", new DependencyGraph());

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
