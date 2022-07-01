import { join } from "https://deno.land/std@0.145.0/path/mod.ts";
import { createContext } from "./context.ts";
import { loadAndFixIndexHtml } from "./html.ts";
import renderer, { type SSR } from "./renderer.ts";
import { fetchRouteData, initRoutes } from "./routing.ts";
import type { HTMLRewriterHandlers, Middleware } from "./types.ts";
import type { RouteConfig } from "../framework/core/route.ts";

type MockServerOptions = {
  appDir?: string;
  routes: string;
  middlewares?: Middleware[];
  ssr?: SSR;
  origin?: string;
};

/** The MockServer class to create a minimal server for integration testing.
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
  #routeConfig: Promise<RouteConfig>;
  #indexHtml: Promise<Uint8Array>;

  constructor(options: MockServerOptions) {
    const { appDir, routes, ssr } = options;
    this.#options = options;
    this.#routeConfig = initRoutes(routes, appDir);
    this.#indexHtml = loadAndFixIndexHtml(join(appDir ?? "./", "index.html"), {
      ssr: typeof ssr === "function" ? {} : ssr,
    });
  }

  async fetch(input: string, init?: RequestInit) {
    const { middlewares, ssr, origin } = this.#options;
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

    const reqData = req.method === "GET" &&
      (url.searchParams.has("_data_") || req.headers.get("Accept") === "application/json");
    const res = await fetchRouteData((await this.#routeConfig).routes, url, req, ctx, reqData);
    if (res) {
      return res;
    }

    return renderer.fetch(req, ctx, {
      indexHtml: await this.#indexHtml,
      routeConfig: await this.#routeConfig,
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
