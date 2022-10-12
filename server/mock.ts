import { createContext } from "./context.ts";
import { join } from "./deps.ts";
import { createHtmlResponse, loadIndexHtml } from "./html.ts";
import renderer from "./renderer.ts";
import { fetchRouteData, initRouter } from "./routing.ts";
import type { Middleware, Router, RouterInit, SessionOptions, SSR } from "./types.ts";

type MockServerOptions = {
  router?: RouterInit;
  appDir?: string;
  origin?: string;
  middlewares?: Middleware[];
  session?: SessionOptions;
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

  fetch(input: string, init?: RequestInit) {
    const { middlewares, origin } = this.#options;
    const url = new URL(input, origin ?? "http://localhost/");
    const req = new Request(url.href, init);
    const next = (i: number): Promise<Response> | Response => {
      if (Array.isArray(middlewares) && i < middlewares.length) {
        const mw = middlewares[i];
        const ctx = createContext(req, next.bind(null, i + 1), { session: this.#options.session });
        try {
          return mw.fetch(req, ctx);
        } catch (err) {
          throw new Error(`Middleare${mw.name ? `(${mw.name})` : ""}:`, err);
        }
      }
      const ctx = createContext(req, () => Promise.resolve(new Response(null)), { session: this.#options.session });
      return this.#handler(req, ctx);
    };
    return next(0);
  }

  async #handler(req: Request, ctx: Context) {
    const { ssr, router, appDir } = this.#options;
    const { searchParams } = new URL(req.url);

    if (!this.#router && router) {
      this.#router = await initRouter(router, appDir);
    }
    if (!this.#indexHtml) {
      this.#indexHtml = await loadIndexHtml(join(appDir ?? "./", "index.html"), {
        ssr: Boolean(ssr),
      });
    }

    if (this.#router) {
      const _data_ = req.method === "GET" &&
        (searchParams.has("_data_") || req.headers.get("Accept") === "application/json");
      const res = await fetchRouteData(req, ctx, this.#router, _data_);
      if (res) {
        return res;
      }
    }

    if (!this.#indexHtml) {
      return new Response("Not found", { status: 404 });
    }

    if (!ssr) {
      return createHtmlResponse(req, join(appDir ?? ".", "./index.html"), this.#indexHtml);
    }

    return renderer.fetch(req, ctx, {
      indexHtml: this.#indexHtml,
      router: this.#router,
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
