import { join, resolve } from "https://deno.land/std@0.144.0/path/mod.ts";
import { createContext } from "./context.ts";
import { globalIt, loadImportMap } from "./helpers.ts";
import { loadAndFixIndexHtml } from "./html.ts";
import renderer, { type SSR } from "./renderer.ts";
import { fetchRouteData, initRoutes } from "./routing.ts";
import type { Middleware } from "./types.ts";

type MockServerOptions = {
  routes: string;
  middlewares?: Middleware[];
  ssr?: SSR;
  cwd?: string;
  origin?: string;
};

/** The MockServer class to create a minimal server for integration testing.
 *
 * Limits:
 * - importing css is _NOT_ allowed
 * - custom loader is _NOT_ supported, like `import './foo.vue'`
 *
 * @example
 * ```ts
 * import { assertEquals } from "std/testing/asserts.ts";
 * import { MockServer } from "aleph/server/mock.ts";
 *
 * Deno.test(async () => {
 *    const api = new MockServer({
 *      routes: "./routes/**\/*.ts"
 *    });
 *    const res = await api.fetch("/users?page=1&limit=10");
 *    assertEquals(res.status, 200);
 *    assertEquals((await res.json()).length, 10);
 * })
 * ```
 */
export class MockServer {
  #options: MockServerOptions;

  constructor(options: MockServerOptions) {
    this.#options = options;
  }

  async fetch(input: string, init?: RequestInit) {
    const { routes, middlewares, ssr, origin } = this.#options;
    const url = new URL(input, origin ?? "http://localhost/");
    const req = new Request(url.href, init);
    const customHTMLRewriter: [selector: string, handlers: HTMLRewriterHandlers][] = [];
    const ctx = createContext(req, { customHTMLRewriter });

    // use middlewares
    if (middlewares) {
      for (let i = 0, l = middlewares.length; i < l; i++) {
        const mw = middlewares[i];
        const handler = mw.fetch;
        if (typeof handler === "function") {
          try {
            let res = handler(req, ctx);
            if (res instanceof Promise) {
              res = await res;
            }
            if (res instanceof Response) {
              return res;
            }
            if (typeof res === "function") {
              setTimeout(res, 0);
            }
          } catch (err) {
            throw new Error(`Middleare${mw.name ? `(${mw.name})` : ""}:`, err);
          }
        }
      }
    }

    const cwd = resolve(this.#options.cwd ?? Deno.cwd());
    const routeTable = await globalIt(
      `mockRoutes:${cwd}${JSON.stringify(routes)}`,
      () => initRoutes(this.#options.cwd ? "./" + join(this.#options.cwd, routes) : routes),
    );
    const reqData = req.method === "GET" &&
      (url.searchParams.has("_data_") || req.headers.get("Accept") === "application/json");
    const res = await fetchRouteData(
      routeTable.routes,
      url,
      req,
      ctx,
      reqData,
      true,
    );
    if (res) {
      return res;
    }

    const importMap = await globalIt(`mockImportMap:${cwd}`, () => loadImportMap(cwd));
    const indexHtml = await globalIt(`mockIndexHtml:${cwd}`, () =>
      loadAndFixIndexHtml({
        importMap,
        ssr: typeof ssr === "function" ? {} : ssr,
        isDev: false,
        cwd,
      }));

    return renderer.fetch(req, ctx, {
      indexHtml,
      routeTable,
      customHTMLRewriter,
      isDev: false,
      noProxy: true,
      ssr,
    });
  }
}

/** mock a `FormData` object. */
export function mockFormData(init?: Record<string, string | Blob | [filename: string, content: Blob]>): FormData {
  const data = new FormData();
  if (init) {
    for (const [key, value] of Object.entries(init)) {
      if (Array.isArray(value)) {
        data.append(key, value[1], value[0]);
      } else {
        data.append(key, value);
      }
    }
  }
  return data;
}
