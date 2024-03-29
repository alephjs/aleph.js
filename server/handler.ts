import { generateErrorHtml, TransformError } from "../framework/core/error.ts";
import type { Router } from "../framework/core/router.ts";
import { isPlainObject, trimSuffix } from "../shared/util.ts";
import { createContext, NEXT } from "./context.ts";
import { handleHMR } from "./dev.ts";
import { HTMLRewriter, path } from "./deps.ts";
import {
  existsDir,
  existsFile,
  fetchCode,
  getAlephPkgUri,
  getAppDir,
  getDeploymentId,
  getImportMap,
  getJSXConfig,
  globalIt,
  isNpmPkg,
  regFullVersion,
  restoreUrl,
  toLocalPath,
} from "./helpers.ts";
import { createHtmlResponse, loadIndexHtml } from "./html.ts";
import log from "./log.ts";
import { getContentType } from "./media_type.ts";
import renderer from "./renderer.ts";
import { fetchRoute, importRouteModule, initRouter } from "./router.ts";
import transformer from "./transformer.ts";
import type { AlephConfig, ConnInfo, Context, ModuleLoader } from "./types.ts";

export function createHandler(config: AlephConfig) {
  const { loaders, middlewares, onError, build, router: routerConfig, ssr } = config;
  const buildMode = Deno.args.includes("--build");
  const isDev = Deno.args.includes("--dev");
  const appDir = getAppDir();

  const staticHandler = async (req: Request): Promise<Response | void> => {
    const { pathname, searchParams } = new URL(req.url);

    // handle HMR socket
    if (pathname === "/-/hmr") {
      if (isDev) {
        return handleHMR(req);
      }
      const { socket, response } = Deno.upgradeWebSocket(req);
      socket.addEventListener("open", () => {
        // tell the client to reload the page if not _dev_ mode
        socket.send(JSON.stringify({ type: "reload" }));
      });
      return response;
    }

    // getStaticPaths PRC for SSR
    if (pathname === "/-/getStaticPaths") {
      const router: Router = await globalIt("__ALEPH_ROUTER", () => initRouter(appDir, routerConfig));
      const pattern = searchParams.get("pattern");
      const route = router.routes.find(([_, r]) => r.pattern.pathname === pattern);
      if (route) {
        const mod = await importRouteModule(route[1]);
        if (typeof mod.getStaticPaths === "function") {
          let ret = mod.getStaticPaths();
          if (ret instanceof Promise) {
            ret = await ret;
          }
          if (Array.isArray(ret)) {
            return Response.json(ret);
          }
        }
      }
      return Response.json([]);
    }

    // check if the `out` directory exists
    const outDir = await globalIt("__ALEPH_OUT_DIR", async () => {
      if (!isDev && !buildMode) {
        const outDir = path.join(appDir, build?.outputDir ?? "output");
        if (await existsDir(outDir)) {
          return outDir;
        }
      }
      return null;
    });

    // transform modules
    let loader: ModuleLoader | undefined;
    if (
      !searchParams.has("raw") && (
        // 1. check loader first
        (loader = loaders?.find((l) => l.test(pathname))) ||
        // 2. check built-in modules
        transformer.test(pathname)
      )
    ) {
      if (pathname.endsWith(".map") && pathname.startsWith("/-/")) {
        const [content, contentType] = await fetchCode(restoreUrl(pathname));
        return new Response(content, {
          headers: [["Content-Type", contentType]],
        });
      }
      // check and use the build output
      if (!isDev && !buildMode && outDir && !searchParams.has("ssr")) {
        let outFile = path.join(outDir, pathname);
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
        return await transformer.fetch(req, {
          importMap,
          jsxConfig,
          loader,
          isDev,
        });
      } catch (err) {
        if (err instanceof TransformError) {
          // todo: pretty error message in terminal
          log.error(err.message);
          const alephPkgUri = toLocalPath(getAlephPkgUri());
          return new Response(
            `import { showTransformError } from "${alephPkgUri}/framework/core/error.ts";showTransformError(${
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
          return onError?.(err, "transform", req) ??
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
        let filePath = path.join(appDir, pathname);
        let stat = await Deno.lstat(filePath);
        if (stat.isDirectory && pathname !== "/") {
          filePath = `${trimSuffix(filePath, "/")}/index.html`;
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
          return new Response(file.readable, { headers });
        }
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) {
          log.error(err);
          return onError?.(err, "fs", req) ??
            new Response(generateErrorHtml(err.stack ?? err.message), {
              status: 500,
              headers: [["Content-Type", "text/html;"]],
            });
        }
      }
    }
  };

  const routeHandler = async (req: Request, ctx: Context): Promise<Response> => {
    const { pathname, searchParams } = new URL(req.url);

    // don't render special asset files
    switch (pathname) {
      case "/favicon.ico":
      case "/robots.txt":
        return new Response("Not found", { status: 404 });
      default:
        if (pathname.startsWith("/-/") || pathname.startsWith("/.")) {
          return new Response("Not found", { status: 404 });
        }
    }

    // get the router
    const router: Router = await globalIt("__ALEPH_ROUTER", () => initRouter(appDir, routerConfig));

    // for SSR dynamic data
    if (router.routes.length > 0) {
      try {
        const res = await fetchRoute(req, ctx, router);
        if (res) return res;
      } catch (err) {
        const fetchData = req.method === "GET" && searchParams.has("_data_");

        // user throws a response
        if (err instanceof Response) {
          return err;
        }

        // javascript syntax error
        if (err instanceof TypeError && !fetchData) {
          return new Response(generateErrorHtml(err.stack ?? err.message), {
            status: 500,
            headers: [["Content-Type", "text/html;"]],
          });
        }

        // use the `onError` if available
        const res = onError?.(err, fetchData ? "fetch-route-data" : "fetch-route", req, ctx);
        if (res instanceof Response) {
          return res;
        }

        // prints the error stack
        if (err instanceof Error || typeof err === "string") {
          log.error(err);
        }

        // return the error as a json
        let status: number = err.status ?? err.code;
        if (!Number.isInteger(status)) {
          status = 500;
        }
        return Response.json({
          ...err,
          status,
          message: err.message ?? String(err),
          stack: err.stack,
        }, { status });
      }
    }

    // load index.html
    const indexHtml = await globalIt(
      "__ALEPH_INDEX_HTML",
      () =>
        loadIndexHtml(path.join(appDir, "index.html"), {
          hmr: isDev ? { wsUrl: Deno.env.get("HMR_WS_URL") } : undefined,
          ssr: ssr ? { root: isPlainObject(ssr) ? ssr.root : undefined } : undefined,
        }),
    );
    if (!indexHtml) {
      return new Response("Not found", { status: 404 });
    }

    // non SSR
    if (
      !ssr || (isPlainObject(ssr) && (
        (ssr.exclude instanceof RegExp && ssr.exclude.test(pathname)) ||
        (Array.isArray(ssr.exclude) && ssr.exclude.some((p) => p.test(pathname))) ||
        (ssr.include instanceof RegExp && !ssr.include.test(pathname)) ||
        (Array.isArray(ssr.include) && !ssr.include.some((p) => p.test(pathname)))
      ))
    ) {
      const stream = new ReadableStream({
        start: (controller) => {
          const rewriter = new HTMLRewriter("utf8", (chunk: Uint8Array) => {
            controller.enqueue(chunk);
          });
          // inject the router manifest
          rewriter.on("head", {
            element(el) {
              if (router.routes.length > 0) {
                const json = JSON.stringify({
                  routes: router.routes.map(([_, meta]) => meta),
                  prefix: router.prefix,
                });
                el.append(`<script id="router-manifest" type="application/json">${json}</script>`, {
                  html: true,
                });
              }
            },
          });
          try {
            rewriter.write(indexHtml);
            rewriter.end();
          } finally {
            rewriter.free();
          }
          controller.close();
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=",
        },
      });
    }

    // check if the `out` directory exists
    const outDir = await globalIt("__ALEPH_OUT_DIR", async () => {
      if (!isDev && !buildMode) {
        const outDir = path.join(appDir, build?.outputDir ?? "output");
        if (await existsDir(outDir)) {
          return outDir;
        }
      }
      return null;
    });

    // use SSG output if exists
    if (!isDev && !buildMode && outDir) {
      const htmlFile = path.join(outDir, pathname === "/" ? "index.html" : pathname + ".html");
      if (await existsFile(htmlFile)) {
        return createHtmlResponse(req, htmlFile);
      }
    }

    // SSR
    try {
      return await renderer.fetch(req, ctx, { indexHtml, router, ssr, isDev });
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
      return new Response(generateErrorHtml(message, "SSR"), {
        headers: {
          "Cache-Control": "public, max-age=0, must-revalidate",
          "Content-Type": "text/html; charset=utf-8",
        },
      });
    }
  };

  // the deno http server handler
  return async (req: Request, connInfo: ConnInfo): Promise<Response> => {
    const res = await staticHandler(req);
    if (res) return res;

    const ctx = createContext(() => Promise.resolve(new Response(null)), {
      req,
      connInfo,
      sessionOptions: config.session,
    });
    const next = (i: number): Promise<Response> | Response => {
      if (Array.isArray(middlewares) && i < middlewares.length) {
        const mw = middlewares[i];
        try {
          Reflect.set(ctx, NEXT, next.bind(null, i + 1));
          return mw.fetch(req, ctx);
        } catch (err) {
          const res = onError?.(err, "middleware", req, ctx);
          if (res instanceof Response) {
            return res;
          }
          log.error(`[middleare${mw.name ? `(${mw.name})` : ""}]`, err);
          return new Response(generateErrorHtml(err.stack ?? err.message), {
            status: 500,
            headers: [["Content-Type", "text/html; charset=utf-8"]],
          });
        }
      }
      return routeHandler(req, ctx);
    };
    return next(0);
  };
}
