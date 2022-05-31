import { createContext } from "../server/context.ts";
import { fixResponse, toResponse } from "../server/response.ts";
import type { Middleware } from "../server/types.ts";

let _mockMiddlewares: Middleware[] = [];

export function mockMiddlewares(middlewares: Middleware[]) {
  _mockMiddlewares = middlewares;
}

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
 * import { mockAPIRequest, mockMiddlewares } from "aleph/tests/mock.ts";
 * import * as usersAPI from "./routes/api/users.ts";
 *
 * mockMiddlewares([ ... ]);
 *
 * Deno.test(async () => {
 *    const res = await mockAPIRequest(usersAPI, "GET", "/users");
 *    assertEquals(res.status, 200);
 *    assertEquals((await res.json()).length, 200);
 * })
 * ```
 */
export async function mockAPIRequest(
  route: Record<string, unknown>,
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
  url: string,
  body?: RequestInit,
): Promise<Response> {
  const req = new Request(new URL(url, "http://localhost/").href, { method, ...body });
  const ctx = createContext(req);

  // use mock middlewares
  for (let i = 0, l = _mockMiddlewares.length; i < l; i++) {
    const mw = _mockMiddlewares[i];
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

  const fetcher = route[req.method] ?? (route.data as Record<string, unknown> | undefined)?.[req.method.toLowerCase()];
  if (typeof fetcher === "function") {
    const res = await fetcher(req, ctx);
    if (res instanceof Response) {
      return fixResponse(res, ctx.headers, true);
    }
    return toResponse(res, ctx.headers);
  }
  return new Response("Method Not Allowed", { status: 405 });
}
