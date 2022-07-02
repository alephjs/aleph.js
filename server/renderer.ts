import { join } from "https://deno.land/std@0.145.0/path/mod.ts";
import { FetchError } from "../framework/core/error.ts";
import type { RouteConfig, RouteModule } from "../framework/core/route.ts";
import { matchRoutes } from "../framework/core/route.ts";
import util from "../lib/util.ts";
import { getDeploymentId, getFiles, getUnoGenerator } from "./helpers.ts";
import type { Element } from "./html.ts";
import { HTMLRewriter } from "./html.ts";
import { importRouteModule } from "./routing.ts";
import type { AlephConfig, HTMLRewriterHandlers } from "./types.ts";

export type SSRContext = {
  readonly url: URL;
  readonly routeModules: RouteModule[];
  readonly headCollection: string[];
  readonly dataDefer: boolean;
  readonly signal: AbortSignal;
  readonly bootstrapScripts?: string[];
  readonly onError?: (error: unknown) => void;
};

export type SSRFn = {
  (ssr: SSRContext): Promise<ReadableStream | string> | ReadableStream | string;
};

// Options for the content-security-policy
// https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy
export type CSP = {
  getPolicy: (url: URL, nonce?: string) => string | null;
  nonce?: boolean;
};

export type SSR = {
  cacheControl?: "private" | "public";
  CSP?: CSP;
  dataDefer: true;
  render: (ssr: SSRContext) => Promise<ReadableStream> | ReadableStream;
} | {
  cacheControl?: "private" | "public";
  CSP?: CSP;
  dataDefer?: false;
  render: SSRFn;
} | SSRFn;

export type SSRResult = {
  context: SSRContext;
  body: ReadableStream | string;
  deferedData: Record<string, unknown>;
  nonce?: string;
  is404?: boolean;
};

export type RenderOptions = {
  indexHtml: Uint8Array;
  routeConfig: RouteConfig | null;
  customHTMLRewriter: [selector: string, handlers: HTMLRewriterHandlers][];
  isDev?: boolean;
  ssr?: SSR;
};

/** The virtual `bootstrapScript` to mark the ssr streaming initial UI is ready */
const bootstrapScript = `data:text/javascript;charset=utf-8;base64,${btoa("/* stage ready */")}`;

export default {
  async fetch(req: Request, ctx: Record<string, unknown>, options: RenderOptions): Promise<Response> {
    const { indexHtml, routeConfig, customHTMLRewriter, isDev, ssr } = options;
    const headers = new Headers(ctx.headers as Headers);
    let ssrRes: SSRResult | null = null;
    if (typeof ssr === "function" || typeof ssr?.render === "function") {
      const isFn = typeof ssr === "function";
      const dataDefer = isFn ? false : !!ssr.dataDefer;
      const cc = !isFn ? ssr.cacheControl : "public";
      const CSP = isFn ? undefined : ssr.CSP;
      const render = isFn ? ssr : ssr.render;
      const [url, routeModules, deferedData] = await initSSR(req, ctx, routeConfig, dataDefer);
      const headCollection: string[] = [];
      const ssrContext: SSRContext = {
        url,
        routeModules,
        headCollection,
        dataDefer,
        signal: req.signal,
        bootstrapScripts: [bootstrapScript],
        onError: (_error: unknown) => {
          // todo: handle suspense ssr error
        },
      };

      let body = await render(ssrContext);
      if (typeof body !== "string" && !(body instanceof ReadableStream)) {
        body = "";
      }

      // inline css
      routeModules.forEach(({ filename, inlineCSS }) => {
        if (inlineCSS) {
          headCollection.push(
            `<style data-module-id=${JSON.stringify(filename)} ssr>${inlineCSS}</style>`,
          );
        }
      });

      // build unocss
      const config: AlephConfig | undefined = Reflect.get(globalThis, "__ALEPH_CONFIG");
      if (config?.unocss && Array.isArray(config.unocss.presets)) {
        const test: RegExp = config.unocss.test instanceof RegExp ? config.unocss.test : /\.(jsx|tsx)$/;
        const dir = config?.baseUrl ? new URL(".", config.baseUrl).pathname : Deno.cwd();
        const files = await getFiles(dir);
        const inputSources = await Promise.all(
          files.filter((name) => test.test(name)).map((name) => Deno.readTextFile(join(dir, name))),
        );
        const unoGenerator = getUnoGenerator();
        if (unoGenerator) {
          const start = performance.now();
          let css = Reflect.get(globalThis, "__ALEPH_GLOBAL_UNOCSS");
          if (!css) {
            const ret = await unoGenerator.generate(inputSources.join("\n"), {
              minify: !isDev,
            });
            css = ret.css;
            if (!isDev) {
              Reflect.set(globalThis, "__ALEPH_GLOBAL_UNOCSS", css);
            }
          }
          if (css) {
            const buildTime = performance.now() - start;
            headCollection.push(
              `<link rel="stylesheet" href="/-/esm.sh/@unocss/reset@0.41.1/tailwind.css">`,
              `<style data-unocss="${unoGenerator.version}" data-build-time="${buildTime}ms">${css}</style>`,
            );
          }
        }
      }

      if (routeModules.every(({ dataCacheTtl: ttl }) => typeof ttl === "number" && !Number.isNaN(ttl) && ttl > 0)) {
        const ttls = routeModules.map(({ dataCacheTtl }) => Number(dataCacheTtl));
        headers.append("Cache-Control", `${cc}, max-age=${Math.min(...ttls)}`);
      } else {
        headers.append("Cache-Control", `${cc}, max-age=0, must-revalidate`);
      }
      ssrRes = {
        context: ssrContext,
        body,
        deferedData,
        is404: routeConfig !== null && (routeModules.length === 0 || routeModules.at(-1)?.url.pathname ===
            "/_404"),
      };
      if (!isDev && CSP) {
        const nonce = CSP.nonce ? Date.now().toString(36) : undefined;
        const policy = CSP.getPolicy(url, nonce!);
        if (policy) {
          headers.append("Content-Security-Policy", policy);
          if (policy.includes("nonce-" + nonce)) {
            ssrRes.nonce = nonce;
          }
        }
      }
    } else {
      const deployId = getDeploymentId();
      let etag: string | null = null;
      if (deployId) {
        etag = `W/${btoa("./index.html").replace(/[^a-z0-9]/g, "")}-${deployId}`;
      } else {
        try {
          const { mtime, size } = await Deno.lstat("./index.html");
          if (mtime) {
            etag = `W/${mtime.getTime().toString(16)}-${size.toString(16)}`;
            headers.append("Last-Modified", new Date(mtime).toUTCString());
          }
        } catch (err) {
          if (!(err instanceof Deno.errors.NotFound)) {
            throw err;
          }
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
            if (routeConfig && routeConfig.routes.length > 0) {
              const json = JSON.stringify({
                routes: routeConfig.routes.map(([_, meta]) => meta),
                prefix: routeConfig.prefix,
              });
              el.append(`<script id="routes-manifest" type="application/json">${json}</script>`, {
                html: true,
              });
            }
          },
        });

        if (ssrRes) {
          const {
            context: { routeModules, headCollection },
            body,
            deferedData,
            nonce,
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
                    error: data instanceof Error ? { message: data.message, stack: data.stack } : undefined,
                    data: defered ? undefined : data instanceof Error ? undefined : data,
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
                const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
                el.append(
                  `<script type="module"${nonceAttr}>${importStmts}window.__ROUTE_MODULES={${kvs}};</script>`,
                  { html: true },
                );
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
          if (nonce) {
            rewriter.on("script", {
              element(el: Element) {
                const typeAttr = el.getAttribute("type");
                if ((!typeAttr || typeAttr === "module") && !el.getAttribute("src")) {
                  el.setAttribute("nonce", nonce);
                }
              },
            });
          }
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
    return new Response(stream, { headers, status: ssrRes?.is404 ? 404 : 200 });
  },
};

/** import route modules and fetch data for SSR */
async function initSSR(
  req: Request,
  ctx: Record<string, unknown>,
  routeConfig: RouteConfig | null,
  dataDefer: boolean,
): Promise<[
  url: URL,
  routeModules: RouteModule[],
  deferedData: Record<string, unknown>,
]> {
  const url = new URL(req.url);
  if (!routeConfig) {
    return [url, [], {}];
  }

  const matches = matchRoutes(url, routeConfig);
  const deferedData: Record<string, unknown> = {};

  // import module and fetch data for each matched route
  const modules = await Promise.all(matches.map(async ([ret, meta]) => {
    const mod = await importRouteModule(meta, routeConfig.appDir);
    const dataConfig = util.isPlainObject(mod.data) ? mod.data : mod;
    const rmod: RouteModule = {
      url: new URL(ret.pathname.input + url.search, url.href),
      params: ret.pathname.groups,
      filename: meta.filename,
      defaultExport: mod.default,
      dataCacheTtl: dataConfig?.cacheTtl as (number | undefined),
      inlineCSS: (mod.CSS as string | undefined),
    };

    // assign route params to context
    Object.assign(ctx.params as Record<string, string>, ret.pathname.groups);

    // check the `get` method of data, if `suspense` is enabled then return a promise instead
    const fetcher = dataConfig.get ?? dataConfig.GET;
    if (typeof fetcher === "function") {
      const fetchData = async () => {
        let res: unknown;
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
        if (res instanceof Response) {
          if (res.status >= 400) {
            throw await FetchError.fromResponse(res);
          }
          if (res.status >= 300) {
            if (res.headers.has("Location")) {
              throw res;
            }
            throw new FetchError(500, "Missing the `Location` header");
          }
          try {
            const data = await res.json();
            if (dataDefer) {
              deferedData[rmod.url.pathname + rmod.url.search] = data;
            }
            return data;
          } catch (_e) {
            throw new FetchError(500, "Data must be valid JSON");
          }
        } else if (res === null || util.isPlainObject(res) || Array.isArray(res)) {
          if (dataDefer) {
            deferedData[rmod.url.pathname + rmod.url.search] = res;
          }
          return res;
        } else {
          throw new FetchError(500, "Data must be valid JSON");
        }
      };
      rmod.withData = true;
      if (dataDefer) {
        rmod.data = fetchData;
      } else {
        try {
          rmod.data = await fetchData();
        } catch (error) {
          if (error instanceof Error) {
            rmod.data = error;
          } else {
            throw error;
          }
        }
      }
    }

    return rmod;
  }));

  return [
    url,
    modules.filter(({ defaultExport }) => defaultExport !== undefined),
    deferedData,
  ];
}
