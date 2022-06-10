import type { ConnInfo, ServeInit } from "https://deno.land/std@0.142.0/http/server.ts";
import { serve as stdServe, serveTls } from "https://deno.land/std@0.142.0/http/server.ts";
import { readableStreamFromReader } from "https://deno.land/std@0.142.0/streams/conversion.ts";
import type { RouteTable } from "../framework/core/route.ts";
import log, { LevelName } from "../lib/log.ts";
import { getContentType } from "../lib/mime.ts";
import util from "../lib/util.ts";
import { createContext, type SessionOptions } from "./context.ts";
import { type ErrorCallback, generateErrorHtml } from "./error.ts";
import { DependencyGraph } from "./graph.ts";
import {
  getDeploymentId,
  globalIt,
  initModuleLoaders,
  loadImportMap,
  loadJSXConfig,
  regFullVersion,
} from "./helpers.ts";
import { loadAndFixIndexHtml } from "./html.ts";
import renderer, { type SSR } from "./renderer.ts";
import { content, fixResponse, json, setCookieHeader } from "./response.ts";
import { fetchRouteData, initRoutes, revive } from "./routing.ts";
import clientModuleTransformer from "./transformer.ts";
import type { AlephConfig, FetchHandler, Middleware } from "./types.ts";

export type ServerOptions = Omit<ServeInit, "onError"> & {
  certFile?: string;
  keyFile?: string;
  logLevel?: LevelName;
  session?: SessionOptions;
  middlewares?: Middleware[];
  fetch?: FetchHandler;
  ssr?: SSR;
  onError?: ErrorCallback;
} & AlephConfig;

export const serve = (options: ServerOptions = {}) => {
  const { routes, unocss, build, devServer, middlewares, fetch, ssr, logLevel, onError } = options;
  const isDev = Deno.env.get("ALEPH_ENV") === "development";

  // server handler
  const handler = async (req: Request, connInfo: ConnInfo): Promise<Response> => {
    const url = new URL(req.url);
    const { pathname, searchParams } = url;

    // close the hot-reloading websocket connection and tell the client to reload
    // this request occurs when the client try to connect to the hot-reloading websocket in production mode
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

    const postMiddlewares: Middleware[] = [];
    const customHTMLRewriter: [selector: string, handlers: HTMLRewriterHandlers][] = [];
    const ctx = createContext(req, { connInfo, customHTMLRewriter });

    // use eager middlewares
    if (Array.isArray(middlewares)) {
      for (let i = 0, l = middlewares.length; i < l; i++) {
        const mw = middlewares[i];
        const handler = mw.fetch;
        if (typeof handler === "function") {
          if (mw.eager) {
            try {
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
            } catch (err) {
              const res = onError?.(err, { by: "middleware", url: req.url, context: ctx });
              if (res instanceof Response) {
                return res;
              }
              log.error(`[middleare${mw.name ? `(${mw.name})` : ""}]`, err);
              return new Response(generateErrorHtml(err.stack ?? err.message), {
                status: 500,
                headers: [["Content-Type", "text/html"]],
              });
            }
          } else {
            postMiddlewares.push(mw);
          }
        }
      }
    }

    // transform client modules
    if (clientModuleTransformer.test(pathname)) {
      try {
        const importMap = await globalIt("__ALEPH_IMPORT_MAP", loadImportMap);
        const jsxConfig = await globalIt("__ALEPH_JSX_CONFIG", () => loadJSXConfig(importMap));
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
    const moduleLoaders = await globalIt("__ALEPH_MODULE_LOADERS", initModuleLoaders);
    const loader = moduleLoaders.find((loader) => loader.test(pathname));
    if (loader) {
      try {
        const importMap = await globalIt("__ALEPH_IMPORT_MAP", loadImportMap);
        const jsxConfig = await globalIt("__ALEPH_JSX_CONFIG", () => loadJSXConfig(importMap));
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

    // use post middlewares
    for (const mw of postMiddlewares) {
      try {
        let res = mw.fetch(req, ctx);
        if (res instanceof Promise) {
          res = await res;
        }
        if (res instanceof Response) {
          return res;
        }
        if (typeof res === "function") {
          setTimeout(res, 0);
        }
      } catch (err) {
        const res = onError?.(err, { by: "middleware", url: req.url, context: ctx });
        if (res instanceof Response) {
          return res;
        }
        log.error(`[middleare${mw.name ? `(${mw.name})` : ""}]`, err);
        return new Response(generateErrorHtml(err.stack ?? err.message), {
          status: 500,
          headers: [["Content-Type", "text/html"]],
        });
      }
    }

    // use the `fetch` handler if available
    if (typeof fetch === "function") {
      return fetch(req, ctx);
    }

    // request route api
    const routeTable: RouteTable = await globalIt(
      "__ALEPH_ROUTES",
      () => routes ? initRoutes(routes) : Promise.resolve({ routes: [] }),
    );
    if (routeTable.routes.length > 0) {
      const reqData = req.method === "GET" &&
        (url.searchParams.has("_data_") || req.headers.get("Accept") === "application/json");
      try {
        const resp = await fetchRouteData(routeTable.routes, url, req, ctx, reqData);
        if (resp) {
          return resp;
        }
      } catch (err) {
        // javascript syntax error
        if (err instanceof TypeError && !reqData) {
          return new Response(generateErrorHtml(err.stack ?? err.message), {
            status: 500,
            headers: [["Content-Type", "text/html"]],
          });
        }

        // use the `onError` if available
        const res = onError?.(err, { by: "route-data-fetch", url: req.url, context: ctx });
        if (res instanceof Response) {
          return fixResponse(res, ctx.headers, reqData);
        }

        // user throw a response
        if (err instanceof Response) {
          return fixResponse(err, ctx.headers, reqData);
        }

        // prints the error stack
        if (err instanceof Error || typeof err === "string") {
          log.error(err);
        }

        // return the error as a json
        const status: number = util.isUint(err.status ?? err.code) ? err.status ?? err.code : 500;
        return json({ ...err, status, message: err.message ?? String(err), stack: err.stack }, {
          status,
          headers: ctx.headers,
        });
      }
    }

    // don't render those special asset files
    switch (pathname) {
      case "/favicon.ico":
      case "/robots.txt":
        return new Response("Not found", { status: 404 });
    }

    try {
      const importMap = await globalIt("__ALEPH_IMPORT_MAP", loadImportMap);
      const indexHtml = await globalIt("__ALEPH_INDEX_HTML", () =>
        loadAndFixIndexHtml({
          isDev,
          importMap,
          ssr: typeof ssr === "function" ? {} : ssr,
          hmrWebSocketUrl: options.devServer?.hmrWebSocketUrl,
        }));
      return renderer.fetch(req, ctx, {
        indexHtml,
        routeTable,
        customHTMLRewriter,
        isDev,
        ssr,
      });
    } catch (err) {
      if (err instanceof Response) {
        return err;
      }
      let message: string;
      if (err instanceof Error) {
        message = err.stack as string;
        log.error("SSR", err);
      } else {
        message = err?.toString?.() || String(err);
      }
      const cc = ssr && typeof ssr !== "function" ? ssr.cacheControl : "public";
      ctx.headers.append("Cache-Control", `${cc}, max-age=0, must-revalidate`);
      ctx.headers.append("Content-Type", "text/html; charset=utf-8");
      return new Response(generateErrorHtml(message, "SSR"), { headers: ctx.headers });
    }
  };

  // set log level if specified
  if (logLevel) {
    log.setLevel(logLevel);
  }

  // inject global objects
  Reflect.set(globalThis, "__ALEPH_CONFIG", { routes, unocss, build, devServer });
  Reflect.set(globalThis, "__ALEPH_CLIENT_DEP_GRAPH", new DependencyGraph());

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
