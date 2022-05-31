import { createContext } from "./context.ts";
import { fetchData, initRoutes } from "./routing.ts";
import type { SSR } from "./renderer.ts";
import type { Middleware, RoutesConfig } from "./types.ts";

type MockServerOptions = {
  routes: string | RoutesConfig;
  middlewares?: Middleware[];
  ssr?: SSR;
};

/** The MockServer class to create a minimal server for integration testing.
 *
 * ```ts
 * import { assertEquals } from "std/testing/asserts.ts";
 * import Mock from "aleph/tests/mock.ts";
 *
 * Deno.test(async () => {
 *    const api = new Mock({ routes: "./routes/**\/*.ts" });
 *    const res = api.fetch("/users")
 *    assertEquals(res.status, 200);
 *    assertEquals((await res.json()).length, 200);
 * })
 * ```
 */
export default class MockServer {
  #options: MockServerOptions;

  constructor({ routes, middlewares }: MockServerOptions) {
    this.#options = { routes, middlewares };
  }

  async fetch(input: string, init?: RequestInit) {
    const { middlewares, routes } = this.#options;
    const url = new URL(input, "http://localhost/");
    const req = new Request(url.href, init);
    const ctx = createContext(req);

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

    const res = await fetchData((await initRoutes(routes)).routes, url, req, ctx, true, true);
    return res ?? new Response("Method Not Allowed", { status: 405 });
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
