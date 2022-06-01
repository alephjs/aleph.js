import { createContext } from "./context.ts";
import { globalIt, loadImportMap } from "./helpers.ts";
import { loadAndFixIndexHtml } from "./html.ts";
import renderer, { type SSR } from "./renderer.ts";
import { fetchData, initRoutes } from "./routing.ts";
import type { Middleware, RoutesConfig } from "./types.ts";

type MockServerOptions = {
  routes: string | RoutesConfig;
  middlewares?: Middleware[];
  ssr?: SSR;
  origin?: string;
};

/** The MockServer class to create a minimal server for integration testing.
 *
 * ```ts
 * import { assertEquals } from "std/testing/asserts.ts";
 * import { MockServer } from "aleph/server/mock.ts";
 *
 * Deno.test(async () => {
 *    const api = new MockServer({
 *      routes: "./routes/**\/*.ts"
 *    });
 *    const res = await api.fetch("/users")
 *    assertEquals(res.status, 200);
 *    assertEquals((await res.json()).length, 50);
 * })
 * ```
 */
export class MockServer {
  #options: MockServerOptions;

  constructor({ routes, middlewares }: MockServerOptions) {
    this.#options = { routes, middlewares };
  }

  async fetch(input: string, init?: RequestInit) {
    const { middlewares, routes, ssr, origin } = this.#options;
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

    const [routeRecord, importMap] = await globalIt(
      Deno.cwd() + JSON.stringify(routes),
      () => {
        return Promise.all([initRoutes(routes), loadImportMap()]);
      },
    );

    const res = await fetchData(routeRecord.routes, url, req, ctx, true, true);
    if (res) {
      return res;
    }

    const indexHtml = await loadAndFixIndexHtml({
      importMap,
      ssr: typeof ssr === "function" ? {} : ssr,
      isDev: false,
    });
    return renderer.fetch(req, ctx, {
      indexHtml,
      routeRecord,
      customHTMLRewriter,
      isDev: false,
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
