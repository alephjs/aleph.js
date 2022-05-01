import FetchError from "../framework/core/fetch_error.ts";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import type { RouteModule, Routes } from "../lib/route.ts";
import { matchRoutes } from "../lib/route.ts";
import { errorHtml } from "./error.ts";
import type { DependencyGraph, Module } from "./graph.ts";
import { builtinModuleExts, getDeploymentId, getUnoGenerator } from "./helpers.ts";
import type { Element, HTMLRewriterHandlers } from "./html.ts";
import { HTMLRewriter } from "./html.ts";
import { importRouteModule } from "./routing.ts";

export type SSRContext = {
  readonly url: URL;
  readonly routeModules: RouteModule[];
  readonly headCollection: string[];
  readonly suspense: boolean;
  readonly errorBoundaryHandler?: CallableFunction;
  readonly signal: AbortSignal;
  readonly bootstrapScripts?: string[];
  readonly onError?: (error: unknown) => void;
};

export type SSR = {
  suspense: true;
  render(ssr: SSRContext): Promise<ReadableStream> | ReadableStream;
} | {
  suspense?: false;
  render(ssr: SSRContext): Promise<string | ReadableStream> | string | ReadableStream;
} | ((ssr: SSRContext) => Promise<string | ReadableStream> | string | ReadableStream);

export type SSRResult = {
  context: SSRContext;
  errorBoundaryHandlerFilename?: string;
  body: ReadableStream | string;
  suspenseData: Record<string, unknown>;
};

export type RenderOptions = {
  routes: Routes;
  indexHtml: Uint8Array;
  customHTMLRewriter: Map<string, HTMLRewriterHandlers>;
  isDev: boolean;
  ssr?: SSR;
};

/** The virtual `bootstrapScript` to mark the ssr streaming initial UI is ready */
const bootstrapScript = `data:text/javascript;charset=utf-8;base64,${btoa("/* stage ready */")}`;

export default {
  async fetch(req: Request, ctx: Record<string, unknown>, options: RenderOptions): Promise<Response> {
    const { indexHtml, routes, customHTMLRewriter, isDev, ssr } = options;
    const headers = new Headers(ctx.headers as Headers);
    let ssrRes: SSRResult | null = null;
    if (ssr) {
      const suspense = typeof ssr === "function" ? false : !!ssr.suspense;
      const [url, routeModules, suspenseData, errorBoundaryHandler] = await initSSR(req, ctx, routes, suspense);
      const render = typeof ssr === "function" ? ssr : ssr.render;
      try {
        const headCollection: string[] = [];
        const ssrContext: SSRContext = {
          url,
          routeModules,
          headCollection,
          suspense,
          errorBoundaryHandler: errorBoundaryHandler?.default,
          signal: req.signal,
          bootstrapScripts: [bootstrapScript],
          onError: (_error: unknown) => {
            // todo: handle suspense error
          },
        };
        const body = await render(ssrContext);
        const serverDependencyGraph: DependencyGraph | undefined = Reflect.get(globalThis, "serverDependencyGraph");
        if (serverDependencyGraph) {
          const atomicCSSSource: Promise<string>[] = [];
          const lookupModuleStyle = (mod: Module) => {
            const { specifier, sourceCode, atomicCSS, inlineCSS } = mod;
            if (atomicCSS) {
              atomicCSSSource.push(
                sourceCode ? Promise.resolve(sourceCode) : Deno.readTextFile(specifier).then((text) => {
                  Object.assign(mod, { sourceCode: text });
                  return text;
                }),
              );
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
          if (atomicCSSSource.length > 0) {
            // todo: cache the atomic CSS in production mode
            const unoGenerator = getUnoGenerator();
            if (unoGenerator) {
              const start = performance.now();
              const input = (await Promise.all(atomicCSSSource)).join("\n");
              const { css } = await unoGenerator.generate(input, {
                minify: !isDev,
              });
              if (css) {
                headCollection.push(
                  `<style data-unocss="${unoGenerator.version}" data-build-time="${
                    performance.now() - start
                  }ms">${css}</style>`,
                );
              }
            }
          }
        }
        const ttls = routeModules.filter(({ dataCacheTtl }) =>
          typeof dataCacheTtl === "number" && !Number.isNaN(dataCacheTtl) && dataCacheTtl > 0
        ).map(({ dataCacheTtl }) => Number(dataCacheTtl));
        if (ttls.length > 1) {
          headers.append("Cache-Control", `public, max-age=${Math.min(...ttls)}`);
        } else if (ttls.length == 1) {
          headers.append("Cache-Control", `public, max-age=${ttls[0]}`);
        } else {
          headers.append("Cache-Control", "public, max-age=0, must-revalidate");
        }
        ssrRes = {
          context: ssrContext,
          errorBoundaryHandlerFilename: errorBoundaryHandler?.filename,
          body,
          suspenseData,
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
        headers.append("Cache-Control", "public, max-age=0, must-revalidate");
        headers.append("Content-Type", "text/html; charset=utf-8");
        return new Response(errorHtml(message, "SSR"), { headers });
      }
    } else {
      const { mtime, size } = await Deno.lstat("./index.html");
      if (mtime) {
        const etag = mtime.getTime().toString(16) + "-" + size.toString(16);
        if (etag && req.headers.get("If-None-Match") === etag) {
          return new Response(null, { status: 304 });
        }
        headers.append("Etag", etag);
        headers.append("Last-Modified", mtime.toUTCString());
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

        // apply user defined html rewrite handlers
        customHTMLRewriter.forEach((handlers, selector) => rewriter.on(selector, handlers));

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
            suspenseData,
          } = ssrRes;
          rewriter.on("head", {
            element(el: Element) {
              headCollection.forEach((h) => util.isFilledString(h) && el.append(h, { html: true }));
              if (routeModules.length > 0) {
                const ssrModules = routeModules.map(({ url, params, filename, data, dataCacheTtl }) => {
                  const suspense = typeof data === "function" ? true : undefined;
                  return {
                    url: url.pathname + url.search,
                    params,
                    filename,
                    data: suspense ? undefined : data,
                    suspense,
                    dataCacheTtl,
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
                    if (Object.keys(suspenseData).length > 0) {
                      controller.enqueue(
                        util.utf8TextEncoder.encode(
                          `<script type="application/json" id="suspense-data">${JSON.stringify(suspenseData)}</script>`,
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
  routes: Routes,
  suspense: boolean,
): Promise<
  [
    url: URL,
    routeModules: RouteModule[],
    suspenseData: Record<string, unknown>,
    errorBoundaryHandler: { filename: string; default: CallableFunction } | undefined,
  ]
> {
  const url = new URL(req.url);
  const matches = matchRoutes(url, routes);
  const suspenseData: Record<string, unknown> = {};

  // import module and fetch data for each matched route
  const modules = await Promise.all(matches.map(async ([ret, { filename }]) => {
    const mod = await importRouteModule(filename);
    const dataConfig: Record<string, unknown> = util.isPlainObject(mod.data) ? mod.data : {};
    const rmod: RouteModule = {
      url: new URL(ret.pathname.input + url.search, url.href),
      params: ret.pathname.groups,
      filename: filename,
      defaultExport: mod.default,
      dataCacheTtl: dataConfig?.cacheTtl as (number | undefined),
    };

    // assign route params to context
    Object.assign(ctx.params, ret.pathname.groups);

    // check `any` fetch of data, throw if it returns a response object
    const anyFetcher = dataConfig.any;
    if (typeof anyFetcher === "function") {
      const res = await anyFetcher(req, ctx);
      if (res instanceof Response) {
        throw res;
      }
    }

    // check `get` of data, if `suspense` is enabled then return a promise instead
    const fetcher = dataConfig.get;
    if (typeof fetcher === "function") {
      const fetchData = async () => {
        let res = fetcher(req, ctx);
        if (res instanceof Promise) {
          res = await res;
        }
        if (res instanceof Response) {
          if (res.status >= 500) {
            throw await FetchError.fromResponse(res);
          }
          if (res.status >= 300 && res.status < 400) {
            if (res.headers.has("Location")) {
              throw Response.redirect(res.headers.get("Location")!, res.status);
            }
            throw new FetchError(500, {}, "Missing the `Location` header");
          }
          try {
            const data = await res.json();
            if (suspense) {
              suspenseData[rmod.url.pathname + rmod.url.search] = data;
            }
            return data;
          } catch (_e) {
            throw new FetchError(500, {}, "Data must be valid JSON");
          }
        } else {
          throw new FetchError(500, {}, "Data must be valid JSON");
        }
      };
      if (suspense) {
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
        suspenseData,
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
    suspenseData,
    undefined,
  ];
}
