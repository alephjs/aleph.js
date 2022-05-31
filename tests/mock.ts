import { createContext } from "../server/context.ts";
import { fetchData, initRoutes } from "../server/routing.ts";
import type { Middleware, RoutesConfig } from "../server/types.ts";

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

/** Mock API Request for integration tests, returns a Response object.
 *
 * ```ts
 * import { assertEquals } from "std/testing/asserts.ts";
 * import { mockAPI } from "aleph/tests/mock.ts";
 *
 * Deno.test(async () => {
 *    const api = await mockAPI({ routes: "./routes/**\/*.ts" });
 *    const res = api.fetch("/users")
 *    assertEquals(res.status, 200);
 *    assertEquals((await res.json()).length, 200);
 * })
 * ```
 */
export function mockAPI({ routes, middlewares }: {
  routes: string | RoutesConfig;
  middlewares?: Middleware[];
}) {
  return {
    fetch: async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost/");
      const req = new Request(url.href, init);
      const ctx = createContext(req);

      // use   middlewares
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
    },
  };
}
