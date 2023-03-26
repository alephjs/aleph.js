import type { Router } from "../framework/core/router.ts";
import { isPlainObject } from "../shared/util.ts";
import { createContext, NEXT } from "./context.ts";
import { path } from "./deps.ts";
import { getAppDir } from "./helpers.ts";
import { createHtmlResponse, loadIndexHtml } from "./html.ts";
import renderer from "./renderer.ts";
import { fetchRoute, initRouter } from "./router.ts";
import type { Context, Middleware, RouterInit, SessionOptions, SSR } from "./types.ts";

type MockServerOptions = {
  appDir?: string;
  origin?: string;
  router?: RouterInit;
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
 *      router: {
 *        glob: "./routes/**\/*.ts",
 *       },
 *    });
 *    const res = await api.fetch("/users?page=1&limit=10");
 *    assertEquals(res.status, 200);
 *    assertEquals((await res.json()).length, 10);
 * })
 * ```
 */
export class MockServer {
  #options: MockServerOptions;
  #indexHtml: Uint8Array | null;
  #router: Router | null;

  constructor(options?: MockServerOptions) {
    this.#options = options || {};
    this.#indexHtml = null;
    this.#router = null;
  }

  fetch(input: string, init?: RequestInit) {
    const { middlewares, origin } = this.#options;
    const url = new URL(input, origin ?? "http://localhost/");
    const req = new Request(url.href, init);
    const ctx = createContext(() => Promise.resolve(new Response(null)), {
      req,
      connInfo: {
        localAddr: { transport: "tcp", hostname: "localhost", port: 80 },
        remoteAddr: { transport: "tcp", hostname: "localhost", port: 80 },
      },
      sessionOptions: this.#options.session,
    });
    const next = (i: number): Promise<Response> | Response => {
      if (Array.isArray(middlewares) && i < middlewares.length) {
        const mw = middlewares[i];
        try {
          Reflect.set(ctx, NEXT, next.bind(null, i + 1));
          return mw.fetch(req, ctx);
        } catch (err) {
          throw new Error(`Middleare${mw.name ? `(${mw.name})` : ""}:`, err);
        }
      }
      return this.#handler(req, ctx);
    };
    return next(0);
  }

  async #handler(req: Request, ctx: Context) {
    const { ssr, router, appDir } = this.#options;

    if (!this.#indexHtml) {
      this.#indexHtml = await loadIndexHtml(path.join(appDir ?? "./", "index.html"), {
        ssr: ssr ? { root: isPlainObject(ssr) ? ssr.root : undefined } : undefined,
      });
    }

    if (!this.#router) {
      this.#router = await initRouter(appDir ?? getAppDir(), router);
    }

    if (this.#router) {
      const res = await fetchRoute(req, ctx, this.#router);
      if (res) {
        return res;
      }
    }

    if (!this.#indexHtml) {
      return new Response("Not found", { status: 404 });
    }

    if (!ssr) {
      return createHtmlResponse(req, path.join(appDir ?? ".", "./index.html"), this.#indexHtml);
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
