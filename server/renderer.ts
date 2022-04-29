import FetchError from "../lib/fetch_error.ts";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import type { RouteModule, Routes } from "../lib/route.ts";
import { matchRoutes } from "../lib/route.ts";
import type { DependencyGraph, Module } from "./graph.ts";
import { builtinModuleExts, getDeploymentId, getUnoGenerator } from "./helpers.ts";
import type { Comment, Element } from "./html.ts";
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

export type HTMLRewriterHandlers = {
  element?: (element: Element) => void;
  comments?: (element: Comment) => void;
};

export type SSR = {
  suspense: true;
  render(ssr: SSRContext): Promise<ReadableStream> | ReadableStream;
} | {
  suspense?: false;
  render(ssr: SSRContext): Promise<string | ReadableStream> | string | ReadableStream;
} | ((ssr: SSRContext) => Promise<string | ReadableStream> | string | ReadableStream);

type SSRResult = {
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
            serverDependencyGraph.walk(filename, lookupModuleStyle);
          }
          for (const serverEntry of builtinModuleExts.map((ext) => `./server.${ext}`)) {
            if (serverDependencyGraph.get(serverEntry)) {
              serverDependencyGraph.walk(serverEntry, lookupModuleStyle);
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
          const regStackLoc = /(http:\/\/localhost:60\d{2}\/.+)(:\d+:\d+)/;
          message = (e.stack as string).split("\n").map((line, i) => {
            const ret = line.match(regStackLoc);
            if (ret) {
              const url = new URL(ret[1]);
              line = line.replace(ret[0], `.${url.pathname}${ret[2]}`);
            }
            if (i === 0) {
              return `<strong>SSR ${line}</strong>`;
            }
            return line;
          }).join("\n");
          log.error("SSR", e);
        } else {
          message = e?.toString?.() || String(e);
        }
        headers.append("Cache-Control", "public, max-age=0, must-revalidate");
        headers.append("Content-Type", "text/html; charset=utf-8");
        return new Response(errorHtml(message), { headers });
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
    const fetcher = dataConfig.get;
    if (typeof fetcher === "function") {
      const fetchData = async () => {
        let res = fetcher(req, { ...ctx, params: rmod.params });
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
  const routeModules = modules.filter(({ defaultExport }) => defaultExport !== undefined);
  if (routes._error) {
    const [_, meta] = routes._error;
    const mod = await importRouteModule(meta.filename);
    if (typeof mod.default === "function") {
      return [url, routeModules, suspenseData, { filename: meta.filename, default: mod.default }];
    }
  }
  return [url, routeModules, suspenseData, undefined];
}

const errorHtml = (message: string) => `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>SSR Error - Aleph.js</title>
    <style>
      body {
        overflow: hidden;
      }
      .error {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100vw;
        height: 100vh;
      }
      .error .box {
        box-sizing: border-box;
        position: relative;
        max-width: 80%;
        max-height: 90%;
        overflow: auto;
        padding: 24px 36px;
        border-radius: 12px;
        border: 2px solid rgba(255, 0, 0, 0.8);
        background-color: rgba(255, 0, 0, 0.1);
        color: rgba(255, 0, 0, 1);
      }
      .error .logo {
        position: absolute;
        top: 50%;
        left: 50%;
        margin-top: -45px;
        margin-left: -45px;
        opacity: 0.1;
      }
      .error pre {
        position: relative;
        line-height: 1.4;
      }
      .error code {
        font-size: 14px;
      }
    </style>
  </head>
  <body>
    <div class="error">
      <div class="box">
        <div class="logo">
          <svg width="90" height="90" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M52.9528 11.1C54.0959 11.1 55.1522 11.7097 55.7239 12.6995C68.5038 34.8259 81.2837 56.9524 94.0636 79.0788C94.642 80.0802 94.6355 81.316 94.0425 82.3088C93.0466 83.9762 92.028 85.6661 91.0325 87.3331C90.4529 88.3035 89.407 88.9 88.2767 88.9C62.7077 88.9 37.0519 88.9 11.4828 88.9C10.3207 88.9 9.25107 88.2693 8.67747 87.2586C7.75465 85.6326 6.81025 84.0065 5.88797 82.3805C5.33314 81.4023 5.34422 80.2041 5.90662 79.2302C18.6982 57.0794 31.4919 34.8415 44.3746 12.6907C44.9474 11.7058 46.0009 11.1 47.1402 11.1C49.0554 11.1 51.0005 11.1 52.9528 11.1Z" stroke="#f00" stroke-width="3.2" stroke-miterlimit="10" stroke-linejoin="round"/>
            <path d="M28.2002 72.8H80.8002L45.8187 12.5494" stroke="#f00" stroke-width="3.2" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M71.4999 72.7L45.1999 27.2L10.6519 87.1991" stroke="#f00" stroke-width="3.2" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M49.8 35.3L23.5 80.8H93.9333" stroke="#f00" stroke-width="3.2" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <pre><code>${message}</code></pre>
      </div>
    </div>
  </body>
</html>
`;
