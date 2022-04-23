import { builtinModuleExts, FetchError, toLocalPath } from "../lib/helpers.ts";
import { type Comment, type Element, HTMLRewriter } from "../lib/html.ts";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import { getAlephPkgUri } from "./config.ts";
import type { DependencyGraph } from "./graph.ts";
import { importRouteModule } from "./routing.ts";
import type { RouteModule, Routes } from "../lib/route.ts";
import { matchRoutes } from "../lib/route.ts";

export type SSRContext = {
  readonly url: URL;
  readonly routeModules: RouteModule[];
  readonly headCollection: string[];
  readonly errorBoundaryHandler?: CallableFunction;
  readonly suspense: boolean;
  readonly signal: AbortSignal;
  readonly bootstrapScripts?: string[];
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

export type RenderOptions = {
  indexHtml: string;
  routes: Routes;
  isDev: boolean;
  customHTMLRewriter: Map<string, HTMLRewriterHandlers>;
  ssr?: SSR;
};

type SSRResult = {
  context: SSRContext;
  errorBoundaryHandlerFilename?: string;
  body: string | ReadableStream;
  suspenseData: Record<string, unknown>;
};

/** The virtual `bootstrapScript` to mark the ssr streaming initial UI is ready */
const bootstrapScript = `data:text/javascript;charset=utf-8;base64,${btoa("/* hydrate bootstrap */")}`;

export default {
  async fetch(req: Request, ctx: Record<string, unknown>, options: RenderOptions): Promise<Response> {
    const { indexHtml, routes, isDev, customHTMLRewriter, ssr } = options;
    const headers = new Headers(ctx.headers as Headers);
    let ssrRes: SSRResult | null = null;
    if (ssr) {
      const suspense = typeof ssr === "function" ? false : !!ssr.suspense;
      const [url, routeModules, suspenseData, errorBoundaryHandler] = await initSSR(req, ctx, routes, suspense);
      const render = typeof ssr === "function" ? ssr : ssr.render;
      try {
        const headCollection: string[] = [];
        const ssrContext = {
          url,
          routeModules,
          errorBoundaryHandler: errorBoundaryHandler?.default,
          headCollection,
          suspense,
          signal: req.signal,
          bootstrapScripts: suspense ? [bootstrapScript] : undefined,
        };
        const body = await render(ssrContext);
        const serverDependencyGraph: DependencyGraph | undefined = Reflect.get(globalThis, "serverDependencyGraph");
        if (serverDependencyGraph) {
          const styles: string[] = [];
          for (const { filename } of routeModules) {
            serverDependencyGraph.walk(filename, (mod) => {
              if (mod.inlineCSS) {
                styles.push(`<style data-module-id="${mod.specifier}">${mod.inlineCSS}</style>`);
              }
            });
          }
          for (const serverEntry of builtinModuleExts.map((ext) => `./server.${ext}`)) {
            if (serverDependencyGraph.get(serverEntry)) {
              serverDependencyGraph.walk(serverEntry, (mod) => {
                if (mod.inlineCSS) {
                  styles.push(`<style data-module-id="${mod.specifier}">${mod.inlineCSS}</style>`);
                }
              });
              break;
            }
          }
          headCollection.push(...styles);
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
          log.error(e);
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
        const alephPkgUri = getAlephPkgUri();
        const rewriter = new HTMLRewriter("utf8", (chunk: Uint8Array) => {
          if (ssrStreaming) {
            suspenseChunks.push(chunk);
          } else {
            controller.enqueue(chunk);
          }
        });
        const linkHandlers = {
          element(el: Element) {
            let href = el.getAttribute("href");
            if (href) {
              const isHttpUrl = util.isLikelyHttpURL(href);
              if (!isHttpUrl) {
                href = util.cleanPath(href);
                el.setAttribute("href", href);
              }
              if (href.endsWith(".css") && !isHttpUrl && isDev) {
                const specifier = `.${href}`;
                el.setAttribute("data-module-id", specifier);
                el.after(
                  `<script type="module">import hot from "${toLocalPath(alephPkgUri)}/framework/core/hmr.ts";hot(${
                    JSON.stringify(specifier)
                  }).accept();</script>`,
                  { html: true },
                );
              }
            }
          },
        };
        const scriptHandlers = {
          hasModule: false,
          element(el: Element) {
            const src = el.getAttribute("src");
            if (src && !util.isLikelyHttpURL(src)) {
              el.setAttribute("src", util.cleanPath(src));
            }
            if (!scriptHandlers.hasModule && el.getAttribute("type") === "module") {
              el.after(
                `<script nomodule src="${toLocalPath(alephPkgUri)}/framework/core/nomodule.ts"></script>`,
                { html: true },
              );
              scriptHandlers.hasModule = true;
            }
          },
        };
        const headHandlers = {
          element(el: Element) {
            if (routes.routes.length > 0) {
              const json = JSON.stringify({ routes: routes.routes.map(([_, meta]) => meta) });
              el.append(`<script id="routes-manifest" type="application/json">${json}</script>`, {
                html: true,
              });
            }
            if (isDev) {
              el.append(
                `<script type="module">import hot from "${
                  toLocalPath(alephPkgUri)
                }/framework/core/hmr.ts";hot("./index.html").decline();</script>`,
                { html: true },
              );
            }
          },
        };

        // apply user defined html rewrite handlers
        customHTMLRewriter.forEach((handlers, selector) => rewriter.on(selector, handlers));

        if (ssrRes) {
          const {
            context: { routeModules, headCollection, suspense },
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

                const importStmts = routeModules.map(({ filename }, idx) =>
                  `import $${idx} from ${JSON.stringify(filename.slice(1))};`
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
          rewriter.on("body", {
            element(el: Element) {
              if (suspense) {
                el.setAttribute("data-suspense", "true");
              }
            },
          });
          rewriter.on("*", {
            comments(c: Comment) {
              const text = c.text.trim().toLowerCase();
              if (text === "ssr-body" || text === "ssr-output") {
                if (typeof body === "string") {
                  c.replace(body, { html: true });
                } else if (body instanceof ReadableStream) {
                  c.remove();
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
                            `<script type="application/json" id="suspense-data">${
                              JSON.stringify(suspenseData)
                            }</script>`,
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
              }
            },
          });
        }

        rewriter.on("link", linkHandlers);
        rewriter.on("script", scriptHandlers);
        rewriter.on("head", headHandlers);

        try {
          rewriter.write(util.utf8TextEncoder.encode(indexHtml));
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
          if (res.status >= 400) {
            throw await FetchError.fromResponse(res);
          }
          if (res.status >= 300) {
            if (res.headers.has("Location")) {
              throw Response.redirect(res.headers.get("Location")!, res.status);
            }
            throw new FetchError(500, {}, "Missing the `Location` header");
          }
          try {
            const data = await res.json();
            suspenseData[rmod.url.pathname + rmod.url.search] = data;
            return data;
          } catch (_e) {
            throw new FetchError(500, {}, "Data must be valid JSON");
          }
        } else {
          throw new Error("Data response must be a JSON");
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
      .error pre {
        position: relative;
        line-height: 1.4;
      }
      .error code {
        font-size: 14px;
      }
      .logo {
        position: absolute;
        top: 50%;
        left: 50%;
        margin-top: -45px;
        margin-left: -45px;
        opacity: 0.1;
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
