import { builtinModuleExts, FetchError, toLocalPath } from "../lib/helpers.ts";
import { type Element, HTMLRewriter } from "../lib/html.ts";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import { getAlephPkgUri } from "./config.ts";
import type { DependencyGraph } from "./graph.ts";
import { importRouteModule } from "./routing.ts";
import type { SSRContext } from "./types.ts";
import type { Route, RouteModule } from "../lib/route.ts";
import { matchRoutes } from "../lib/route.ts";

export type HTMLRewriterHandlers = {
  element?: (element: Element) => void;
};

export type RenderOptions = {
  indexHtml: string;
  routes: Route[];
  isDev: boolean;
  customHTMLRewriter: Map<string, HTMLRewriterHandlers>;
  ssr?: (ssr: SSRContext) => string | Promise<string>;
};

export default {
  async fetch(req: Request, ctx: Record<string, unknown>, options: RenderOptions): Promise<Response> {
    const { indexHtml, routes, isDev, customHTMLRewriter, ssr } = options;
    const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" });
    const ssrHTMLRewriter: Map<string, HTMLRewriterHandlers> = new Map();
    if (ssr) {
      const [url, routeModules, errorBoundaryModule] = await initSSR(req, ctx, routes);
      for (const { redirect } of routeModules) {
        if (redirect) {
          return new Response(null, redirect);
        }
      }
      try {
        const headCollection: string[] = [];
        const ssrOutput = await ssr({ url, routeModules, errorBoundaryModule, headCollection });
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
        ssrHTMLRewriter.set("ssr-head", {
          element(el: Element) {
            headCollection.forEach((h) => util.isFilledString(h) && el.before(h, { html: true }));
            if (routeModules.length > 0) {
              const importStmts = routeModules.map(({ filename }, idx) =>
                `import $${idx} from ${JSON.stringify(filename.slice(1))};`
              ).join("");
              const kvs = routeModules.map(({ filename, data }, idx) =>
                `${JSON.stringify(filename)}:{defaultExport:$${idx}${data !== undefined ? ",withData:true" : ""}}`
              ).join(",");
              const ssrModules = routeModules.map(({ url, filename, error, data, dataCacheTtl }) => ({
                url: url.pathname + url.search,
                module: filename,
                error,
                data,
                dataCacheTtl,
              }));
              el.before(
                `<script id="ssr-modules" type="application/json">${
                  // replace "/" to "\/" to prevent xss
                  JSON.stringify(ssrModules).replaceAll("/", "\\/")
                }</script>`,
                {
                  html: true,
                },
              );
              el.before(`<script type="module">${importStmts}window.__ROUTE_MODULES={${kvs}};</script>`, {
                html: true,
              });
              if (errorBoundaryModule) {
                el.before(
                  `<script type="module">import Handler from ${
                    JSON.stringify(errorBoundaryModule.filename.slice(1))
                  };window.__ERROR_BOUNDARY_HANDLER=Handler</script>`,
                  {
                    html: true,
                  },
                );
              }
            }
            el.remove();
          },
        });
        ssrHTMLRewriter.set("ssr-body", {
          element(el: Element) {
            el.replace(ssrOutput, { html: true });
          },
        });
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
      } catch (error) {
        // todo: better UI & reload
        let message: string;
        if (error instanceof Error) {
          const regStackLoc = /(http:\/\/localhost:60\d{2}\/.+)(:\d+:\d+)/;
          message = (error.stack as string).split("\n").map((line, i) => {
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
        } else {
          message = error?.toString?.() || String(error);
        }
        log.error(error);
        const errorHtml = `
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
                .aleph-logo {
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
                  <div class="aleph-logo">
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
        headers.append("Cache-Control", "public, max-age=0, must-revalidate");
        return new Response(errorHtml, { headers });
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
        const rewriter = new HTMLRewriter("utf8", (chunk: Uint8Array) => controller.enqueue(chunk));
        const alephPkgUri = getAlephPkgUri();
        const linkHandler = {
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
        const scriptHandler = {
          nomoduleInserted: false,
          element(el: Element) {
            const src = el.getAttribute("src");
            if (src && !util.isLikelyHttpURL(src)) {
              el.setAttribute("src", util.cleanPath(src));
            }
            if (el.getAttribute("type") === "module" && !scriptHandler.nomoduleInserted) {
              el.after(`<script nomodule src="${alephPkgUri}/lib/nomodule.js"></script>`, { html: true });
              scriptHandler.nomoduleInserted = true;
            }
          },
        };
        const commonHandler = {
          handled: false,
          element(el: Element) {
            if (commonHandler.handled) {
              return;
            }
            if (routes.length > 0) {
              const json = JSON.stringify({ routes: routes.map(([_, meta]) => meta) });
              el.append(`<script id="route-manifest" type="application/json">${json}</script>`, {
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
              commonHandler.handled = true;
            }
          },
        };

        customHTMLRewriter.forEach((handlers, selector) => rewriter.on(selector, handlers));
        ssrHTMLRewriter.forEach((handlers, selector) => rewriter.on(selector, handlers));
        rewriter.on("link", linkHandler);
        rewriter.on("script", scriptHandler);
        rewriter.on("head", commonHandler);
        rewriter.on("body", commonHandler);
        try {
          rewriter.write(util.utf8TextEncoder.encode(indexHtml));
          rewriter.end();
        } finally {
          controller.close();
          rewriter.free();
        }
      },
    });

    return new Response(stream, { headers });
  },
};

/** import route modules and fetch data for SSR */
async function initSSR(
  req: Request,
  ctx: Record<string, unknown>,
  routes: Route[],
): Promise<[url: URL, routeModules: RouteModule[], errorBoundaryModule: RouteModule | undefined]> {
  const url = new URL(req.url);
  const matches = matchRoutes(url, routes);
  const modules = await Promise.all(matches.map(async ([ret, { filename }]) => {
    const mod = await importRouteModule(filename);
    const dataConfig: Record<string, unknown> = util.isPlainObject(mod.data) ? mod.data : {};
    const rmod: RouteModule = {
      url: new URL(ret.pathname.input + url.search, url.href),
      filename: filename,
      defaultExport: mod.default,
      dataCacheTtl: dataConfig?.cacheTtl as (number | undefined),
    };
    const fetcher = dataConfig.get;
    if (typeof fetcher === "function") {
      try {
        let res = fetcher(req, { ...ctx, params: ret.pathname.groups });
        if (res instanceof Promise) {
          res = await res;
        }
        if (res instanceof Response) {
          if (res.status >= 400) {
            rmod.error = await FetchError.fromResponse(res);
            return rmod;
          }
          if (res.status >= 300) {
            if (res.headers.has("Location")) {
              rmod.redirect = { headers: res.headers, status: res.status };
            } else {
              rmod.error = new FetchError(500, {}, "Missing the `Location` header");
            }
            return rmod;
          }
          try {
            rmod.data = await res.json();
          } catch (_e) {
            rmod.error = new FetchError(500, {}, "Data must be valid JSON");
          }
        }
      } catch (error) {
        rmod.error = error;
      }
    }
    return rmod;
  }));
  const routeModules = modules.filter(({ defaultExport }) => defaultExport !== undefined);
  const errorBoundaryRoute = routes.find(([_, meta]) => meta.pattern.pathname === "/_error");

  if (errorBoundaryRoute) {
    const [_, meta] = errorBoundaryRoute;
    const mod = await importRouteModule(meta.filename);
    if (mod.default !== undefined) {
      const errorBoundaryModule: RouteModule = {
        url: new URL("/_error" + url.search, url.href),
        filename: meta.filename,
        defaultExport: mod.default,
      };
      return [url, routeModules, errorBoundaryModule];
    }
  }
  return [url, routeModules, undefined];
}
