import { generateErrorHtml, TransformError } from "../runtime/core/error.ts";
import log, { type LevelName } from "../lib/log.ts";
import util from "../lib/util.ts";
import { createContext } from "./context.ts";
import { fromFileUrl, join, serve as stdServe, serveTls } from "./deps.ts";
import depGraph from "./graph.ts";
import {
  existsFile,
  fixResponse,
  getAlephPkgUri,
  getDeploymentId,
  getImportMap,
  getJSXConfig,
  globalIt,
  isNpmPkg,
  regFullVersion,
  restoreUrl,
  toLocalPath,
} from "./helpers.ts";
import { loadAndFixIndexHtml } from "./html.ts";
import { getContentType } from "./media_type.ts";
import renderer from "./renderer.ts";
import { fetchRouteData, initRoutes } from "./routing.ts";
import transformer from "./transformer.ts";
import { optimize } from "./optimizer.ts";
import type {
  AlephConfig,
  ConnInfo,
  ErrorHandler,
  FetchHandler,
  HTMLRewriterHandlers,
  Middleware,
  ModuleLoader,
  RouteConfig,
  ServeInit,
  SessionOptions,
  SSR,
} from "./types.ts";

/** The options for the Aleph.js server.  */
export type ServerOptions = Omit<ServeInit, "onError"> & {
  certFile?: string;
  keyFile?: string;
  logLevel?: LevelName;
  session?: SessionOptions;
  middlewares?: Middleware[];
  fetch?: FetchHandler;
  ssr?: SSR;
  onError?: ErrorHandler;
} & AlephConfig;

/** Start the Aleph.js server. */
export function serve(options: ServerOptions = {}) {
  const { baseUrl, fetch, loaders, middlewares, onError, optimization, router, ssr, unocss } = options;
  const appDir = options?.baseUrl ? fromFileUrl(new URL(".", options.baseUrl)) : undefined;
  const isDev = Deno.env.get("ALEPH_ENV") === "development";

  // inject the config to global
  const config: AlephConfig = { baseUrl, router, unocss, loaders, optimization };
  Reflect.set(globalThis, "__ALEPH_CONFIG", config);

  // restore the dependency graph from the re-import route modules
  if (!isDev && router && router.routes && util.isFilledArray(router.routes.depGraph?.modules)) {
    router.routes.depGraph.modules.forEach((module) => {
      depGraph.mark(module.specifier, module);
    });
  }

  // set the log level
  if (import.meta.url.startsWith("file:")) {
    // set log level to debug when debug aleph.js itself.
    log.setLevel("debug");
  } else if (options.logLevel) {
    log.setLevel(options.logLevel);
  }

  // server handler
  const handler = async (req: Request, connInfo: ConnInfo): Promise<Response> => {
    const { pathname, searchParams } = new URL(req.url);

    // close the hot-reloading websocket and tell the client to reload the page
    if (pathname === "/-/hmr") {
      const { socket, response } = Deno.upgradeWebSocket(req);
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "reload" }));
        setTimeout(() => {
          socket.close();
        }, 50);
      });
      return response;
    }

    const customHTMLRewriter: [selector: string, handlers: HTMLRewriterHandlers][] = [];
    const ctx = createContext(req, { connInfo, customHTMLRewriter });
    const postMiddlewares: Middleware[] = [];

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
              const res = onError?.(err, {
                by: "middleware",
                url: req.url,
                context: ctx,
              });
              if (res instanceof Response) {
                return res;
              }
              log.error(`[middleare${mw.name ? `(${mw.name})` : ""}]`, err);
              return new Response(generateErrorHtml(err.stack ?? err.message), {
                status: 500,
                headers: [["Content-Type", "text/html; charset=utf-8"]],
              });
            }
          } else {
            postMiddlewares.push(mw);
          }
        }
      }
    }

    // transform modules
    let loader: ModuleLoader | undefined;
    if (
      !searchParams.has("raw") && (
        (loader = loaders?.find((l) => l.test(pathname))) ||
        transformer.test(pathname)
      )
    ) {
      // check the optimization output
      if (req.headers.get("Pragma") !== "no-output") {
        let outFile = join(appDir ?? Deno.cwd(), optimization?.outputDir ?? "./output", pathname);
        if (pathname.startsWith("/-/") && isNpmPkg(restoreUrl(pathname))) {
          outFile += ".js";
        }
        if (await existsFile(outFile)) {
          const file = await Deno.open(outFile, { read: true });
          const headers = new Headers();
          if (outFile.endsWith(".css")) {
            headers.set("Content-Type", "text/css; charset=utf-8");
          } else {
            headers.set("Content-Type", "application/javascript; charset=utf-8");
          }
          if (searchParams.get("v") || (pathname.startsWith("/-/") && regFullVersion.test(pathname))) {
            headers.append("Cache-Control", "public, max-age=31536000, immutable");
          }
          return new Response(file.readable, { headers });
        }
      }
      try {
        const [importMap, jsxConfig] = await Promise.all([
          getImportMap(appDir),
          getJSXConfig(appDir),
        ]);
        const hydratable = Boolean(ssr);
        return await transformer.fetch(req, {
          importMap,
          jsxConfig,
          loader,
          isDev,
          hydratable,
        });
      } catch (err) {
        console.log(err);
        if (err instanceof TransformError) {
          log.error(err);
          const alephPkgUri = toLocalPath(getAlephPkgUri());
          return new Response(
            `import { showTransformError } from "${alephPkgUri}/runtime/core/error.ts";showTransformError(${
              JSON.stringify(err)
            });export default null;`,
            {
              headers: [
                ["Content-Type", "application/javascript; charset=utf-8"],
                ["X-Transform-Error", "true"],
              ],
            },
          );
        } else if (!(err instanceof Deno.errors.NotFound)) {
          log.error(err);
          return onError?.(err, { by: "transform", url: req.url }) ??
            new Response(generateErrorHtml(err.stack ?? err.message), {
              status: 500,
              headers: [["Content-Type", "text/html;"]],
            });
        }
      }
    }

    // serve static files
    const contentType = getContentType(pathname);
    if (!pathname.startsWith("/.") && contentType !== "application/octet-stream") {
      try {
        let filePath = appDir ? join(appDir, pathname) : `.${pathname}`;
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
            headers.append(
              "Cache-Control",
              "public, max-age=31536000, immutable",
            );
          }
          const file = await Deno.open(filePath, { read: true });
          return new Response(file.readable, { headers });
        }
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) {
          log.error(err);
          return onError?.(err, { by: "fs", url: req.url }) ??
            new Response(generateErrorHtml(err.stack ?? err.message), {
              status: 500,
              headers: [["Content-Type", "text/html;"]],
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
        const res = onError?.(err, {
          by: "middleware",
          url: req.url,
          context: ctx,
        });
        if (res instanceof Response) {
          return res;
        }
        log.error(`[middleare${mw.name ? `(${mw.name})` : ""}]`, err);
        return new Response(generateErrorHtml(err.stack ?? err.message), {
          status: 500,
          headers: [["Content-Type", "text/html;"]],
        });
      }
    }

    // use the `fetch` handler if available
    if (typeof fetch === "function") {
      return fetch(req, ctx);
    }

    // request route api
    const routeConfig: RouteConfig | null = await globalIt(
      "__ALEPH_ROUTE_CONFIG",
      () => router ? initRoutes(router, appDir) : Promise.resolve(null),
    );
    if (routeConfig && routeConfig.routes.length > 0) {
      const reqData = req.method === "GET" &&
        (searchParams.has("_data_") || req.headers.get("Accept") === "application/json");
      try {
        const resp = await fetchRouteData(req, ctx, routeConfig, reqData);
        if (resp) {
          return resp;
        }
      } catch (err) {
        // javascript syntax error
        if (err instanceof TypeError && !reqData) {
          return new Response(generateErrorHtml(err.stack ?? err.message), {
            status: 500,
            headers: [["Content-Type", "text/html;"]],
          });
        }

        // use the `onError` if available
        const res = onError?.(err, {
          by: "route-data-fetch",
          url: req.url,
          context: ctx,
        });
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
        return Response.json({
          ...err,
          status,
          message: err.message ?? String(err),
          stack: err.stack,
        }, {
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

    const indexHtml = await globalIt(
      "__ALEPH_INDEX_HTML",
      () =>
        loadAndFixIndexHtml(join(appDir ?? ".", "index.html"), {
          ssr: typeof ssr === "function" ? {} : ssr,
          hmr: isDev ? { url: Deno.env.get("ALEPH_HMR_WS_URL") } : undefined,
        }),
    );
    if (!indexHtml) {
      return new Response("Not found", { status: 404 });
    }

    // return index.html
    if (!ssr) {
      const deployId = getDeploymentId();
      let etag: string | undefined;
      if (deployId) {
        etag = `W/${btoa("./index.html").replace(/[^a-z0-9]/g, "")}-${deployId}`;
      } else {
        const { mtime, size } = await Deno.lstat(join(appDir ?? ".", "./index.html"));
        if (mtime) {
          etag = `W/${mtime.getTime().toString(16)}-${size.toString(16)}`;
          ctx.headers.set("Last-Modified", new Date(mtime).toUTCString());
        }
      }
      if (etag) {
        if (req.headers.get("If-None-Match") === etag) {
          return new Response(null, { status: 304 });
        }
        ctx.headers.set("ETag", etag);
      }
      ctx.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
      ctx.headers.set("Content-Type", "text/html; charset=utf-8");
      return new Response(indexHtml, { headers: ctx.headers });
    }

    // SSR
    try {
      return await renderer.fetch(req, ctx, {
        indexHtml,
        routeConfig,
        customHTMLRewriter,
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
      return new Response(generateErrorHtml(message, "SSR"), {
        headers: ctx.headers,
      });
    }
  };

  // optimize the application for production
  if (Deno.args.includes("--optimize")) {
    optimize(handler, appDir);
    return;
  }

  const { hostname, port = 3000, certFile, keyFile, signal, onListen } = options;
  if (isDev) {
    // let the dev server handle the requests
    Reflect.set(globalThis, "__ALEPH_SERVER", { handler, hostname, port, certFile, keyFile, signal, onListen });
  } else {
    const useTls = certFile && keyFile;
    const onListen = (arg: { port: number; hostname: string }) => {
      if (!getDeploymentId()) {
        log.info(
          `Server ready on ${useTls ? "https" : "http"}://localhost:${port}`,
        );
      }
      options.onListen?.(arg);
    };
    if (useTls) {
      serveTls(handler, { hostname, port, certFile, keyFile, signal, onListen });
    } else {
      stdServe(handler, { hostname, port, signal, onListen });
    }
  }
}
