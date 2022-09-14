import { createContext } from "./context.ts";
import { join } from "./deps.ts";
import { loadIndexHtml } from "./html.ts";
import renderer from "./renderer.ts";
import { fetchRouteData, initRouter } from "./routing.ts";
import type { HTMLRewriterHandlers, Middleware, Router, RouterInit, SSR } from "./types.ts";

type MockServerOptions = {
  router?: RouterInit;
  appDir?: string;
  origin?: string;
  middlewares?: Middleware[];
  ssr?: SSR;
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
 *      routeGlob: "./routes/**\/*.ts"
 *    });
 *    const res = await api.fetch("/users?page=1&limit=10");
 *    assertEquals(res.status, 200);
 *    assertEquals((await res.json()).length, 10);
 * })
 * ```
 */
export class MockServer {
  #options: MockServerOptions;
  #router: Router | null;
  #indexHtml: Uint8Array | null;

  constructor(options?: MockServerOptions) {
    this.#options = options || {};
    this.#router = null;
    this.#indexHtml = null;
  }

  async fetch(input: string, init?: RequestInit) {
    const { middlewares, ssr, origin, router, appDir } = this.#options;
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

    if (!this.#router && router) {
      this.#router = await initRouter(router, appDir);
    }
    if (!this.#indexHtml) {
      this.#indexHtml = await loadIndexHtml(join(appDir ?? "./", "index.html"), {
        ssr: typeof ssr === "function" ? {} : ssr,
      });
    }

    if (this.#router) {
      const reqData = req.method === "GET" &&
        (url.searchParams.has("_data_") || req.headers.get("Accept") === "application/json");
      const res = await fetchRouteData(req, ctx, this.#router, reqData);
      if (res) {
        return res;
      }
    }

    if (!this.#indexHtml) {
      return new Response("Not found", { status: 404 });
    }

    if (!ssr) {
      ctx.headers.set("Content-Type", "text/html; charset=utf-8");
      return new Response(this.#indexHtml, { headers: ctx.headers });
    }

    return renderer.fetch(req, ctx, {
      indexHtml: this.#indexHtml,
      router: this.#router,
      customHTMLRewriter,
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
