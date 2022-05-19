import FetchError from "../framework/core/fetch_error.ts";
import type { RouteModule, RouteRecord } from "../framework/core/route.ts";
import { matchRoutes } from "../framework/core/route.ts";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import { type ErrorCallback, generateErrorHtml } from "./error.ts";
import type { DependencyGraph, Module } from "./graph.ts";
import { builtinModuleExts, getDeploymentId, getUnoGenerator } from "./helpers.ts";
import type { Element, HTMLRewriterHandlers } from "./html.ts";
import { HTMLRewriter } from "./html.ts";
import { importRouteModule } from "./routing.ts";

export type SSRContext = {
  readonly url: URL;
  readonly routeModules: RouteModule[];
  readonly headCollection: string[];
  readonly dataDefer: boolean;
  readonly errorBoundaryHandler?: CallableFunction;
  readonly signal: AbortSignal;
  readonly bootstrapScripts?: string[];
  readonly onError?: (error: unknown) => void;
};

export type SSRFn = {
  (ssr: SSRContext): Promise<ReadableStream | string> | ReadableStream | string;
};

export type SSR = {
  dataDefer: true;
  cacheControl?: "private" | "public";
  csp?: string | string[];
  render: SSRFn;
} | {
  dataDefer?: false;
  cacheControl?: "private" | "public";
  csp?: string | string[];
  render: SSRFn;
} | SSRFn;

export type SSRResult = {
  context: SSRContext;
  errorBoundaryHandlerFilename?: string;
  body: ReadableStream | string;
  deferedData: Record<string, unknown>;
};

export type RenderOptions = {
  routes: RouteRecord;
  indexHtml: Uint8Array;
  customHTMLRewriter: [string, HTMLRewriterHandlers][];
  isDev: boolean;
  ssr?: SSR;
  onError?: ErrorCallback;
};

/** The virtual `bootstrapScript` to mark the ssr streaming initial UI is ready */
const bootstrapScript = `data:text/javascript;charset=utf-8;base64,${btoa("/* stage ready */")}`;

export default {
  async fetch(req: Request, ctx: Record<string, unknown>, options: RenderOptions): Promise<Response> {
    const { indexHtml, routes, customHTMLRewriter, isDev, ssr, onError } = options;
    const headers = new Headers(ctx.headers as Headers);
    let ssrRes: SSRResult | null = null;
    if (typeof ssr === "function" || typeof ssr?.render === "function") {
      const isFn = typeof ssr === "function";
      const dataDefer = isFn ? false : !!ssr.dataDefer;
      const cc = isFn ? "public" : ssr.cacheControl ?? "public";
      const csp = isFn ? undefined : ssr.csp;
      const render = isFn ? ssr : ssr.render;
      try {
        const [url, routeModules, deferedData, errorBoundaryHandler] = await initSSR(
          req,
          ctx,
          routes,
          dataDefer,
          onError,
        );
        const headCollection: string[] = [];
        const ssrContext: SSRContext = {
          url,
          routeModules,
          headCollection,
          dataDefer,
          errorBoundaryHandler: errorBoundaryHandler?.default,
          signal: req.signal,
          bootstrapScripts: [bootstrapScript],
          onError: (_error: unknown) => {
            // todo: handle suspense ssr error
          },
        };
        const body = await render(ssrContext);
        const serverDependencyGraph: DependencyGraph | undefined = Reflect.get(globalThis, "serverDependencyGraph");
        if (serverDependencyGraph) {
          const unocssTokens: ReadonlyArray<string>[] = [];
          const lookupModuleStyle = (mod: Module) => {
            const { specifier, atomicCSS, inlineCSS } = mod;
            if (atomicCSS) {
              unocssTokens.push(atomicCSS.tokens);
            }
            if (inlineCSS) {
              headCollection.push(`<style data-module-id="${specifier}">${inlineCSS}</style>`);
            }
          };
          for (const { filename } of routeModules) {
            serverDependencyGraph.shallowWalk(filename, lookupModuleStyle);
          }
          for (const serverEntry of builtinModuleExts.map((ext) => `./server.${ext}`)) {
            if (serverDependencyGraph.get(serverEntry)) {
              serverDependencyGraph.shallowWalk(serverEntry, lookupModuleStyle);
              break;
            }
          }
          if (unocssTokens.length > 0) {
            const unoGenerator = getUnoGenerator();
            if (unoGenerator) {
              const start = performance.now();
              const { css } = await unoGenerator.generate(new Set(unocssTokens.flat()), {
                minify: !isDev,
              });
              if (css) {
                const buildTime = performance.now() - start;
                headCollection.push(
                  `<style data-unocss="${unoGenerator.version}" data-build-time="${buildTime}ms">${css}</style>`,
                );
              }
            }
          }
        }
        if (
          routeModules.every(({ dataCacheTtl: ttl }) => typeof ttl === "number" && !Number.isNaN(ttl) && ttl > 0)
        ) {
          const ttls = routeModules.map(({ dataCacheTtl }) => Number(dataCacheTtl));
          headers.append("Cache-Control", `${cc}, max-age=${Math.min(...ttls)}`);
        } else {
          headers.append("Cache-Control", `${cc}, max-age=0, must-revalidate`);
        }
        if (csp) {
          // todo: parse nonce
          headers.append("Content-Security-Policy", [csp].flat().join("; "));
        }
        ssrRes = {
          context: ssrContext,
          errorBoundaryHandlerFilename: errorBoundaryHandler?.filename,
          body,
          deferedData,
        };
      } catch (e) {
        if (e instanceof Response) {
          return e;
        }
        let message: string;
        if (e instanceof Error) {
          message = e.stack as string;
          log.error("SSR", e);
        } else {
          message = e?.toString?.() || String(e);
        }
        headers.append("Cache-Control", `${cc}, max-age=0, must-revalidate`);
        headers.append("Content-Type", "text/html; charset=utf-8");
        return new Response(generateErrorHtml(message, "SSR"), { headers });
      }
    } else {
      const deployId = getDeploymentId();
      let etag: string | null = null;
      if (deployId) {
        etag = `W/${btoa("./index.html").replace(/[^a-z0-9]/g, "")}-${deployId}`;
      } else {
        const { mtime, size } = await Deno.lstat("./index.html");
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
      headers.append("Cache-Control", "public, max-age=0, must-revalidate");
    }

    const stream = new ReadableStream({
      start: (controller) => {
        let ssrStreaming = false;
        const suspenseChunks: Uint8Array[] = [];
        const rewriter = new HTMLRewriter("utf8", (chunk: Uint8Array) => {
          if (ssrStreaming) {
            suspenseChunks.push(chunk);
          } else {
            controller.enqueue(chunk);
          }
        });

        // apply custom html rewrite handlers defined by middlewares
        customHTMLRewriter.forEach(([selector, handlers]) => rewriter.on(selector, handlers));

        // inject the roures manifest
        rewriter.on("head", {
          element(el: Element) {
            if (routes.routes.length > 0) {
              const json = JSON.stringify({ routes: routes.routes.map(([_, meta]) => meta) });
              el.append(`<script id="routes-manifest" type="application/json">${json}</script>`, {
                html: true,
              });
            }
          },
        });

        if (ssrRes) {
          const {
            context: { routeModules, headCollection },
            errorBoundaryHandlerFilename,
            body,
            deferedData,
          } = ssrRes;
          rewriter.on("head", {
            element(el: Element) {
              headCollection.forEach((h) => util.isFilledString(h) && el.append(h, { html: true }));
              if (routeModules.length > 0) {
                const ssrModules = routeModules.map(({ url, params, filename, withData, data, dataCacheTtl }) => {
                  const defered = typeof data === "function" ? true : undefined;
                  return {
                    url: url.pathname + url.search,
                    params,
                    filename,
                    withData,
                    data: defered ? undefined : data,
                    dataCacheTtl,
                    dataDefered: defered,
                  };
                });
                // replace "/" to "\/" to prevent xss
                const modulesJSON = JSON.stringify(ssrModules).replaceAll("/", "\\/");
                el.append(
                  `<script id="ssr-modules" type="application/json">${modulesJSON}</script>`,
                  { html: true },
                );

                const deployId = getDeploymentId();
                const importStmts = routeModules.map(({ filename }, idx) =>
                  `import $${idx} from ${JSON.stringify(filename.slice(1) + (deployId ? `?v=${deployId}` : ""))} ;`
                ).join("");
                const kvs = routeModules.map(({ filename, data }, idx) =>
                  `${JSON.stringify(filename)}:{defaultExport:$${idx}${data !== undefined ? ",withData:true" : ""}}`
                ).join(",");
                el.append(`<script type="module">${importStmts}window.__ROUTE_MODULES={${kvs}};</script>`, {
                  html: true,
                });

                if (errorBoundaryHandlerFilename) {
                  el.append(
                    `<script type="module">import Handler from ${
                      JSON.stringify(errorBoundaryHandlerFilename.slice(1))
                    };window.__ERROR_BOUNDARY_HANDLER=Handler</script>`,
                    { html: true },
                  );
                }
              }
            },
          });
          rewriter.on("ssr-body", {
            element(el: Element) {
              if (typeof body === "string") {
                el.replace(body, { html: true });
              } else if (body instanceof ReadableStream) {
                el.remove();
                ssrStreaming = true;

                const rw = new HTMLRewriter("utf8", (chunk: Uint8Array) => {
                  controller.enqueue(chunk);
                });
                rw.on("script", {
                  element(el: Element) {
                    if (el.getAttribute("src") === bootstrapScript) {
                      suspenseChunks.splice(0, suspenseChunks.length).forEach((chunk) => controller.enqueue(chunk));
                      el.remove();
                    }
                  },
                });
                const send = async () => {
                  try {
                    const reader = body.getReader();
                    while (true) {
                      const { done, value } = await reader.read();
                      if (done) {
                        break;
                      }
                      rw.write(value);
                    }
                    rw.end();
                    if (suspenseChunks.length > 0) {
                      suspenseChunks.forEach((chunk) => controller.enqueue(chunk));
                    }
                    if (Object.keys(deferedData).length > 0) {
                      controller.enqueue(
                        util.utf8TextEncoder.encode(
                          `<script type="application/json" id="defered-data">${JSON.stringify(deferedData)}</script>`,
                        ),
                      );
                    }
                  } finally {
                    controller.close();
                    rw.free();
                  }
                };
                send();
              }
            },
          });
        }

        try {
          rewriter.write(indexHtml);
          rewriter.end();
        } finally {
          if (!ssrRes || typeof ssrRes.body === "string") {
            controller.close();
          }
          rewriter.free();
        }
      },
    });

    headers.set("Content-Type", "text/html; charset=utf-8");
    return new Response(stream, { headers });
  },
};

/** import route modules and fetch data for SSR */
async function initSSR(
  req: Request,
  ctx: Record<string, unknown>,
  routes: RouteRecord,
  dataDefer: boolean,
  onError?: ErrorCallback,
): Promise<
  [
    url: URL,
    routeModules: RouteModule[],
    deferedData: Record<string, unknown>,
    errorBoundaryHandler: { filename: string; default: CallableFunction } | undefined,
  ]
> {
  const url = new URL(req.url);
  const matches = matchRoutes(url, routes);
  const deferedData: Record<string, unknown> = {};

  // import module and fetch data for each matched route
  const modules = await Promise.all(matches.map(async ([ret, { filename }]) => {
    const mod = await importRouteModule(filename);
    const dataConfig = util.isPlainObject(mod.data) ? mod.data : mod;
    const rmod: RouteModule = {
      url: new URL(ret.pathname.input + url.search, url.href),
      params: ret.pathname.groups,
      filename: filename,
      defaultExport: mod.default,
      dataCacheTtl: dataConfig?.cacheTtl as (number | undefined),
    };

    // assign route params to context
    Object.assign(ctx.params, ret.pathname.groups);

    // check the `get` method of data, if `suspense` is enabled then return a promise instead
    const fetcher = dataConfig.get ?? dataConfig.GET;
    if (typeof fetcher === "function") {
      const fetchData = async () => {
        let res: unknown;
        try {
          // check the `any` method of data, throw the response object if it returns one
          const anyFetcher = dataConfig.any ?? dataConfig.ANY;
          if (typeof anyFetcher === "function") {
            const res = await anyFetcher(req, ctx);
            if (res instanceof Response) {
              throw res;
            }
          }
          res = fetcher(req, ctx);
          if (res instanceof Promise) {
            res = await res;
          }
        } catch (error) {
          res = onError?.(error, { by: "ssr", url: req.url, context: ctx });
          if (res instanceof Response) {
            throw res;
          }
          throw error;
        }
        if (res instanceof Response) {
          if (res.status >= 400) {
            throw await FetchError.fromResponse(res);
          }
          if (res.status >= 300) {
            if (res.headers.has("Location")) {
              throw res;
            }
            throw new FetchError(500, {}, "Missing the `Location` header");
          }
          try {
            const data = await res.json();
            if (dataDefer) {
              deferedData[rmod.url.pathname + rmod.url.search] = data;
            }
            return data;
          } catch (_e) {
            throw new FetchError(500, {}, "Data must be valid JSON");
          }
        } else if (res === null || util.isPlainObject(res) || Array.isArray(res)) {
          if (dataDefer) {
            deferedData[rmod.url.pathname + rmod.url.search] = res;
          }
          return res;
        } else {
          throw new FetchError(500, {}, "Data must be valid JSON");
        }
      };
      rmod.withData = true;
      if (dataDefer) {
        rmod.data = fetchData;
      } else {
        rmod.data = await fetchData();
      }
    }

    return rmod;
  }));

  // find error boundary handler
  if (routes._error) {
    const [_, meta] = routes._error;
    const mod = await importRouteModule(meta.filename);
    if (typeof mod.default === "function") {
      return [
        url,
        modules.filter(({ defaultExport }) => defaultExport !== undefined),
        deferedData,
        {
          filename: meta.filename,
          default: mod.default,
        },
      ];
    }
  }

  return [
    url,
    modules.filter(({ defaultExport }) => defaultExport !== undefined),
    deferedData,
    undefined,
  ];
}
