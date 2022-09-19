import { FetchError } from "../runtime/core/error.ts";
import { matchRoutes } from "../runtime/core/route.ts";
import util from "../shared/util.ts";
import { fromFileUrl, HTMLRewriter, join } from "./deps.ts";
import depGraph from "./graph.ts";
import { getAlephConfig, getDeploymentId, getFiles, getUnoGenerator, regJsxFile } from "./helpers.ts";
import log from "./log.ts";
import { importRouteModule } from "./routing.ts";
import type { Element, HTMLRewriterHandlers, RouteModule, Router, SSR, SSRContext, SSRResult } from "./types.ts";

export type RenderOptions = {
  indexHtml: Uint8Array;
  customHTMLRewriter: [selector: string, handlers: HTMLRewriterHandlers][];
  router: Router | null;
  ssr: SSR;
  isDev?: boolean;
};

const runtimeScript = [
  `let e=fn=>new Error('module "'+fn+'" not found');`,
  `const getRouteModule=(fn)=>{`,
  `if(map.has(fn)){`,
  `let m=map.get(fn);`,
  `if(m instanceof Promise) throw e(fn);`,
  `return m;`,
  `}`,
  `throw e(fn);`,
  `};`,
  `const importRouteModule=async(fn)=>{`,
  `if(map.has(fn)){`,
  `let m=map.get(fn);`,
  `if(m instanceof Promise) {`,
  `m=await m;`,
  `map.set(fn,m);`,
  `}`,
  `return m;`,
  `}`,
  `let v=document.body.getAttribute("data-build-id");`,
  `let m=import(fn.slice(1)+(v?"?v="+v:""));`,
  `map.set(fn,m);`,
  `return await m.then(m=>{map.set(fn,m);return m;});`,
  `};`,
  `window.__aleph={getRouteModule,importRouteModule};`,
].join("");

export default {
  async fetch(req: Request, ctx: Record<string, unknown>, options: RenderOptions): Promise<Response> {
    const { indexHtml, router, customHTMLRewriter, ssr, isDev } = options;
    const headers = new Headers(ctx.headers as Headers);
    const isFn = typeof ssr === "function";
    const cc = !isFn ? ssr.cacheControl : "public";
    const CSP = isFn ? undefined : ssr.CSP;
    const render = isFn ? ssr : ssr.render;
    const [url, routeModules, deferedData] = await initSSR(req, ctx, router);
    const headCollection: string[] = [];
    const ssrContext: SSRContext = {
      url,
      routeModules,
      headCollection,
      signal: req.signal,
      nonce: CSP?.nonce ? Date.now().toString(36) : undefined,
      onError: (_error: unknown) => {
        // todo: handle suspense ssr error
      },
    };

    let body = render(ssrContext);
    if (body instanceof Promise) {
      body = await body;
    }
    if (typeof body !== "string" && !(body instanceof ReadableStream)) {
      body = "";
    }

    // find inline css
    depGraph.shallowWalk(routeModules.map(({ filename }) => filename), (mod) => {
      const { specifier, inlineCSS } = mod;
      if (inlineCSS) {
        headCollection.push(`<style data-module-id="${specifier}" ssr>${inlineCSS}</style>`);
      }
    });

    // build unocss
    const config = getAlephConfig();
    if (config?.unocss?.presets) {
      const unoGenerator = getUnoGenerator();
      if (unoGenerator) {
        const t = performance.now();
        const {
          test = regJsxFile,
          resetCSS = "tailwind",
        } = config.unocss;
        let css = Reflect.get(globalThis, "__ALEPH_UNOCSS_BUILD");
        if (!css) {
          const dir = config?.baseUrl ? fromFileUrl(new URL(".", config.baseUrl)) : Deno.cwd();
          const files = await getFiles(dir);
          const outputDir = "." + util.cleanPath(config.optimization?.outputDir ?? "./output");
          const inputSources = await Promise.all(
            files.filter((name) => test.test(name) && !name.startsWith(outputDir)).map((name) =>
              Deno.readTextFile(join(dir, name))
            ),
          );
          if (inputSources.length > 0) {
            const ret = await unoGenerator.generate(inputSources.join("\n"), {
              minify: !isDev,
            });
            if (ret.matched.size > 0) {
              css = ret.css;
              if (!isDev) {
                Reflect.set(globalThis, "__ALEPH_UNOCSS_BUILD", css);
              }
            }
          }
        }
        if (css) {
          const buildTime = (performance.now() - t).toFixed(2);
          headCollection.push(
            `<link rel="stylesheet" href="/-/esm.sh/@unocss/reset@0.45.14/${resetCSS}.css">`,
            `<style data-unocss="${unoGenerator.version}" data-build-time="${buildTime}ms">${css}</style>`,
          );
          log.debug(`Uncss generated in ${buildTime}ms`);
        }
      }
    }

    const ssrRes: SSRResult = {
      body,
      context: ssrContext,
      deferedData,
    };
    if (!isDev && CSP) {
      const nonce = ssrContext.nonce;
      const policy = CSP.getPolicy(url, nonce);
      if (policy) {
        headers.append("Content-Security-Policy", policy);
        if (nonce && policy.includes("nonce-" + nonce)) {
          ssrRes.nonce = nonce;
        }
      }
    }

    const stream = new ReadableStream({
      start: (controller) => {
        let suspenseSSR = false;
        const suspenseChunks: Uint8Array[] = [];
        const rewriter = new HTMLRewriter("utf8", (chunk: Uint8Array) => {
          if (suspenseSSR) {
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
            if (router && router.routes.length > 0) {
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

        const { context, body, deferedData, nonce } = ssrRes;
        const { routeModules, headCollection } = context;

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

              const deployId = getDeploymentId() ?? depGraph.globalVersion.toString(36);
              const importStmts = routeModules.map(({ filename }, idx) =>
                `import * as $${idx} from ${JSON.stringify(filename.slice(1) + (deployId ? `?v=${deployId}` : ""))};`
              ).join("");
              const kvs = routeModules.map(({ filename }, idx) => `${JSON.stringify(filename)}:$${idx}`).join(
                ",",
              );
              const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
              el.append(
                `<script type="module"${nonceAttr}>${importStmts}let map=new Map(Object.entries({${kvs}}));${runtimeScript}</script>`,
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

              const rw = new HTMLRewriter("utf8", (chunk: Uint8Array) => {
                controller.enqueue(chunk);
              });

              if (ssrContext.suspenseMark) {
                const { selector, test } = ssrContext.suspenseMark;
                rw.on(selector, {
                  element(el: Element) {
                    if (test(el)) {
                      suspenseChunks.splice(0, suspenseChunks.length).forEach((chunk) => controller.enqueue(chunk));
                    }
                  },
                });
                suspenseSSR = true;
              }

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

        try {
          rewriter.write(indexHtml);
          rewriter.end();
        } finally {
          if (!suspenseSSR) {
            controller.close();
          }
          rewriter.free();
        }
      },
    });

    if (routeModules.every(({ dataCacheTtl: ttl }) => typeof ttl === "number" && !Number.isNaN(ttl) && ttl > 0)) {
      const ttls = routeModules.map(({ dataCacheTtl }) => Number(dataCacheTtl));
      headers.append("Cache-Control", `${cc}, max-age=${Math.min(...ttls)}`);
    } else {
      headers.append("Cache-Control", `${cc}, max-age=0, must-revalidate`);
    }
    headers.set("Content-Type", "text/html; charset=utf-8");
    return new Response(stream, { headers, status: ssrContext.status });
  },
};

/** import route modules and fetch data for SSR */
async function initSSR(
  req: Request,
  ctx: Record<string, unknown>,
  router: Router | null,
): Promise<[
  url: URL,
  routeModules: RouteModule[],
  deferedData: Record<string, unknown>,
]> {
  const url = new URL(req.url);
  if (!router) {
    return [url, [], {}];
  }

  const matches = matchRoutes(url, router);
  const deferedData: Record<string, unknown> = {};

  // import module and fetch data for each matched route
  const modules = await Promise.all(matches.map(async ([ret, meta]) => {
    const mod = await importRouteModule(meta, router.appDir);
    const dataConfig = util.isPlainObject(mod.data) ? mod.data : mod;
    const dataDefer = Boolean(dataConfig?.defer);
    const rmod: RouteModule = {
      url: new URL(ret.pathname.input + url.search, url.href),
      params: ret.pathname.groups,
      filename: meta.filename,
      exports: mod,
      dataCacheTtl: dataConfig?.cacheTtl as (number | undefined),
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
    modules.filter(({ exports }) => exports.default !== undefined),
    deferedData,
  ];
}
