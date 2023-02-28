import { generateErrorHtml, TransformError } from "../runtime/core/error.ts";
import type { Router } from "../runtime/core/routes.ts";
import { trimSuffix } from "../shared/util.ts";
import { createContext } from "./context.ts";
import { handleHMR } from "./dev.ts";
import { path } from "./deps.ts";
import {
  existsDir,
  existsFile,
  fetchCode,
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
import { createHtmlResponse, loadIndexHtml } from "./html.ts";
import log from "./log.ts";
import { getContentType } from "./media_type.ts";
import renderer from "./renderer.ts";
import { fetchRouteData, importRouteModule, initRouter } from "./routing.ts";
import transformer from "./transformer.ts";
import type { AlephConfig, ConnInfo, ErrorHandler, ModuleLoader } from "./types.ts";

export function createHandler(options: AlephConfig & { onError?: ErrorHandler }) {
  const { baseUrl, loaders, middlewares, onError, build: buildOptions, router: routerConfig, session, ssr } = options;
  const appDir = baseUrl ? path.fromFileUrl(new URL(".", baseUrl)) : undefined;
  const buildMode = Deno.args.includes("--build") || Deno.args.includes("-O");
  const isDev = Deno.args.includes("--dev");

  const handler = async (req: Request, ctx: Context): Promise<Response> => {
    const { pathname, searchParams } = new URL(req.url);

    // handle HMR socket
    if (pathname === "/-/hmr") {
      if (isDev) {
        return handleHMR(req);
      }
      const { socket, response } = Deno.upgradeWebSocket(req);
      socket.addEventListener("open", () => {
        // close the hot-reloading websocket and tell the client to reload the page
        socket.send(JSON.stringify({ type: "reload" }));
        setTimeout(() => {
          socket.close();
        }, 50);
      });
      return response;
    }

    // check if the "out" directory exists
    const outDir = await globalIt("__ALEPH_OUT_DIR", async () => {
      if (!isDev && !buildMode) {
        const outDir = path.join(appDir ?? Deno.cwd(), buildOptions?.outputDir ?? "./output");
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
        transformer.test(pathname) ||
        (loader = loaders?.find((l) => l.test(pathname)))
      )
    ) {
      if (pathname.endsWith(".js.map") && pathname.startsWith("/-/")) {
        const [content, contentType] = await fetchCode(restoreUrl(pathname));
        return new Response(content, {
          headers: [["Content-Type", contentType]],
        });
      }
      // check the optimized output
      if (!isDev && !buildMode && outDir) {
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
          // todo: format error message in terminal
          log.error(err.message);
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
          return onError?.(err, "transform", req, ctx) ??
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
        let filePath = appDir ? path.join(appDir, pathname) : `.${pathname}`;
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
          return onError?.(err, "fs", req, ctx) ??
            new Response(generateErrorHtml(err.stack ?? err.message), {
              status: 500,
              headers: [["Content-Type", "text/html;"]],
            });
        }
      }
    }

    // request route api
    const router: Router | null = await globalIt("__ALEPH_ROUTER", () => initRouter(routerConfig, appDir));

    if (pathname === "/__aleph.getStaticPaths") {
      if (router) {
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
      }
      return Response.json([]);
    }

    if (router && router.routes.length > 0) {
      const _data_ = req.method === "GET" &&
        (searchParams.has("_data_") || req.headers.get("Accept") === "application/json");
      try {
        const resp = await fetchRouteData(req, ctx, router, _data_);
        if (resp) {
          return resp;
        }
      } catch (err) {
        // javascript syntax error
        if (err instanceof TypeError && !_data_) {
          return new Response(generateErrorHtml(err.stack ?? err.message), {
            status: 500,
            headers: [["Content-Type", "text/html;"]],
          });
        }

        // use the `onError` if available
        const res = onError?.(err, "route-data-fetch", req, ctx);
        if (res instanceof Response) {
          return fixResponse(res, _data_);
        }

        // user throws a response
        if (err instanceof Response) {
          return fixResponse(err, _data_);
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

    // don't render those special asset files
    switch (pathname) {
      case "/favicon.ico":
      case "/robots.txt":
        return new Response("Not found", { status: 404 });
    }

    const indexHtml = await globalIt(
      "__ALEPH_INDEX_HTML",
      () =>
        loadIndexHtml(path.join(appDir ?? ".", "index.html"), {
          ssr: Boolean(ssr),
          hmr: isDev ? { wsUrl: Deno.env.get("HMR_WS_URL") } : undefined,
        }),
    );
    if (!indexHtml) {
      return new Response("Not found", { status: 404 });
    }

    // return index.html
    if (!ssr) {
      return createHtmlResponse(req, path.join(appDir ?? ".", "./index.html"), indexHtml);
    }

    // check SSG output
    if (!isDev && !buildMode && outDir) {
      const htmlFile = path.join(outDir, pathname === "/" ? "index.html" : pathname + ".html");
      if (await existsFile(htmlFile)) {
        return createHtmlResponse(req, htmlFile);
      }
    }

    // SSR
    try {
      return await renderer.fetch(req, ctx, {
        indexHtml,
        router,
        ssr,
        isDev,
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
      return new Response(generateErrorHtml(message, "SSR"), {
        headers: {
          "Cache-Control": "public, max-age=0, must-revalidate",
          "Content-Type": "text/html; charset=utf-8",
        },
      });
    }
  };

  // the final server handler
  return (req: Request, connInfo: ConnInfo): Promise<Response> | Response => {
    const next = (i: number): Promise<Response> | Response => {
      if (Array.isArray(middlewares) && i < middlewares.length) {
        const mw = middlewares[i];
        const ctx = createContext(req, next.bind(null, i + 1), { connInfo, session });
        try {
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
      const ctx = createContext(req, () => Promise.resolve(new Response(null)), { connInfo, session });
      return handler(req, ctx);
    };
    return next(0);
  };
}
