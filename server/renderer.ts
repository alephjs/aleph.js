import { FetchError } from "../framework/core/error.ts";
import { matchRoutes, type RouteModule, type Router } from "../framework/core/router.ts";
import { cleanPath, isFilledString, isPlainObject, utf8Enc } from "../shared/util.ts";
import { HTMLRewriter, path } from "./deps.ts";
import depGraph from "./graph.ts";
import { getAlephConfig, getAppDir, getDeploymentId, getFiles, regJsxFile, toLocalPath } from "./helpers.ts";
import log from "./log.ts";
import { importRouteModule } from "./router.ts";
import type { HTMLRewriterHandlers, SSR, SSRContext, SuspenseMarker } from "./types.ts";

export type RenderOptions = {
  indexHtml: Uint8Array;
  router: Router;
  ssr: SSR;
  isDev?: boolean;
};

export default {
  async fetch(req: Request, ctx: Record<string, unknown>, options: RenderOptions): Promise<Response> {
    const { indexHtml, router, ssr, isDev } = options;
    const headers = new Headers(ctx.headers as Headers);
    const isFn = typeof ssr === "function";
    const CSP = isFn ? undefined : ssr.CSP;
    const render = isFn ? ssr : ssr.render;
    const [url, modules, deferedData] = await initSSR(req, ctx, router);
    const headCollection: string[] = [];
    const customHTMLRewriter = ctx.__htmlRewriterHandlers as [string, HTMLRewriterHandlers][];

    let status = 200;
    let suspenseMarker: SuspenseMarker | undefined;
    let nonce: string | undefined;

    const ssrContext: SSRContext = {
      url,
      modules,
      headCollection,
      signal: req.signal,
      setStatus: (code) => {
        status = code;
      },
      setSuspenseMarker: (selector, test) => {
        suspenseMarker = { selector, test };
      },
    };

    if (!isDev && CSP) {
      const _nonce = CSP.nonce ? Date.now().toString(36) : undefined;
      const policy = CSP.getPolicy(url, _nonce);
      if (policy) {
        headers.append("Content-Security-Policy", policy);
        if (_nonce && policy.includes("nonce-" + _nonce)) {
          nonce = _nonce;
          (ssrContext as Record<string, unknown>).nonce = _nonce;
        }
      }
    }

    let body = await render(ssrContext);
    if (typeof body !== "string" && !(body instanceof ReadableStream)) {
      log.warn("Invalid SSR body");
      body = "";
    }

    // find inline css
    depGraph.shallowWalk(modules.map(({ filename }) => filename), (mod) => {
      const { specifier, inlineCSS } = mod;
      if (inlineCSS) {
        headCollection.push(`<style data-module-id="${specifier}" ssr>${inlineCSS}</style>`);
      }
    });

    // build unocss
    const config = getAlephConfig();
    if (config?.atomicCSS) {
      const { atomicCSS, build } = config;
      const { test = regJsxFile, resetCSS } = atomicCSS;
      let css = Reflect.get(globalThis, "__ALEPH_ATOMICCSS_BUILD");
      if (!css) {
        const t = performance.now();
        const appDir = getAppDir();
        const files = await getFiles(appDir);
        const outputDir = "." + cleanPath(build?.outputDir ?? "./output");
        const inputSources = await Promise.all(
          files.filter((name) => test.test(name) && !name.startsWith(outputDir)).map((name) =>
            Deno.readTextFile(path.join(appDir, name))
          ),
        );
        if (inputSources.length > 0) {
          const ret = await atomicCSS.generate(inputSources.join("\n"), {
            minify: !isDev,
          });
          if (ret.matched.size > 0) {
            css = ret.css;
            if (!isDev) {
              Reflect.set(globalThis, "__ALEPH_ATOMICCSS_BUILD", css);
            }
            log.debug(
              `Atomic CSS generated in ${(performance.now() - t).toFixed(2)}ms`,
              atomicCSS.name && atomicCSS.version ? `(Powered by ${atomicCSS.name}@${atomicCSS.version})` : "",
            );
          }
        }
      }
      if (css) {
        if (resetCSS) {
          headCollection.push(`<link rel="stylesheet" href="${toLocalPath(resetCSS)}">`);
        }
        headCollection.push(`<style>${css}</style>`);
      }
    }

    const stream = new ReadableStream({
      start: (controller) => {
        let streamStarted = false;

        const suspenseChunks: Uint8Array[] = [];
        const rewriter = new HTMLRewriter("utf8", (chunk: Uint8Array) => {
          if (streamStarted) {
            suspenseChunks.push(chunk);
          } else {
            controller.enqueue(chunk);
          }
        });

        // apply custom html rewrite handlers defined by middlewares
        customHTMLRewriter.forEach(([selector, handlers]) => rewriter.on(selector, handlers));

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

        rewriter.on("head", {
          element(el) {
            const ssrModules = modules.map(({ url, params, filename, withData, data, dataCacheTtl }) => {
              const defered = typeof data === "function" ? true : undefined;
              return {
                url: url.pathname + url.search,
                params,
                filename,
                withData,
                dataCacheTtl,
                data: defered ? undefined : data instanceof Error ? undefined : data,
                dataDefered: defered,
                error: data instanceof Error ? { message: data.message, stack: data.stack } : undefined,
              };
            });

            // replace "/" to "\/" to prevent xss
            const modulesJSON = JSON.stringify(ssrModules).replaceAll("/", "\\/");
            el.append(
              `<script id="ssr-data" type="application/json">${modulesJSON}</script>`,
              { html: true },
            );

            // add module preload links
            const deployId = getDeploymentId();
            const q = deployId ? `?v=${deployId}` : "";
            el.append(
              modules.map(({ filename }) =>
                `<link rel="modulepreload" href="${filename.slice(1)}${q}" data-module-id="${filename}" />`
              ).join(""),
              { html: true },
            );

            headCollection.forEach((h) => isFilledString(h) && el.append(h, { html: true }));
          },
        });

        rewriter.on("ssr-body", {
          element(el) {
            if (typeof body === "string") {
              el.replace(body, { html: true });
            } else if (body instanceof ReadableStream) {
              streamStarted = true;
              el.remove();

              const rw = new HTMLRewriter("utf8", (chunk: Uint8Array) => {
                controller.enqueue(chunk);
              });

              if (suspenseMarker) {
                rw.on(suspenseMarker.selector, {
                  element(el) {
                    if (suspenseMarker!.test(el)) {
                      suspenseChunks.splice(0, suspenseChunks.length).forEach((chunk) => controller.enqueue(chunk));
                    }
                  },
                });
              }

              const reader = body.getReader();
              const send = async () => {
                try {
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
                      utf8Enc.encode(
                        `<script type="application/json" id="defered-data">${JSON.stringify(deferedData)}</script>`,
                      ),
                    );
                  }
                } finally {
                  try {
                    controller.close();
                  } catch (error) {
                    log.warn(error);
                  }
                  rw.free();
                }
              };
              send();
            }
          },
        });

        if (nonce) {
          rewriter.on("script", {
            element(el) {
              const typeAttr = el.getAttribute("type");
              if ((!typeAttr || typeAttr === "module") && !el.getAttribute("src")) {
                el.setAttribute("nonce", nonce!);
              }
            },
          });
        }

        try {
          rewriter.write(indexHtml);
          rewriter.end();
        } finally {
          if (!streamStarted) {
            controller.close();
          }
          rewriter.free();
        }
      },
    });

    if (!headers.has("Cache-Control")) {
      headers.append("Cache-Control", "public, max-age=0, must-revalidate");
    }
    headers.set("Content-Type", "text/html; charset=utf-8");

    return new Response(stream, { headers, status });
  },
};

/** import route modules and fetch data for SSR */
async function initSSR(
  req: Request,
  ctx: Record<string, unknown>,
  router: Router,
): Promise<[
  url: URL,
  routing: RouteModule[],
  deferedData: Record<string, unknown>,
]> {
  const url = new URL(req.url);
  const matches = matchRoutes(url, router);
  const deferedData: Record<string, unknown> = {};

  // import module and fetch data for each matched route
  const modules = await Promise.all(matches.map(async ([ret, meta]) => {
    const mod = await importRouteModule(meta, router.appDir);
    const dataConfig = mod.data;
    const rmod: RouteModule = {
      url: new URL(ret.pathname.input + url.search, url.href),
      params: ret.pathname.groups,
      filename: meta.filename,
      exports: mod,
    };

    let fetcher: CallableFunction | undefined;
    let dataDefer = false;
    if (typeof dataConfig === "function") {
      fetcher = dataConfig;
    } else if (isPlainObject(dataConfig)) {
      const { fetch, defer, cacheTtl } = dataConfig;
      fetcher = typeof fetch === "function" ? fetch : undefined;
      dataDefer = Boolean(defer);
      rmod.dataCacheTtl = typeof cacheTtl === "number" ? cacheTtl : undefined;
    } else {
      fetcher = mod.GET;
    }

    // assign route params to context
    Object.assign(ctx.params as Record<string, string>, ret.pathname.groups);

    if (typeof fetcher === "function") {
      const fetchData = async () => {
        let res: unknown;
        res = fetcher!(req, ctx);
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
        } else if (res === null || isPlainObject(res) || Array.isArray(res)) {
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
        } catch (v) {
          if (v instanceof Error) {
            rmod.data = v;
          } else {
            throw v;
          }
        }
      }
    }

    return rmod;
  }));

  return [
    url,
    modules.filter(({ exports }) => exports.default !== undefined),
    deferedData,
  ];
}
