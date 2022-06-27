import util from "../lib/util.ts";
import { createContext } from "./context.ts";
import { globalIt } from "./helpers.ts";
import { loadAndFixIndexHtml } from "./html.ts";
import renderer, { type SSR } from "./renderer.ts";
import { fetchRouteData, initRoutes } from "./routing.ts";
import type { Middleware } from "./types.ts";

type MockServerOptions = {
  appDir?: string;
  routes: string;
  middlewares?: Middleware[];
  ssr?: SSR;
  origin?: string;
};

/** The MockServer class to create a minimal server for integration testing.
 *
 * Limits:
 * - importing css is _NOT_ allowed: `import "./style.css"`
 * - custom loader is _NOT_ supported, like `import "./component.vue"`
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

    const appDir = this.#options.appDir ? "." + util.cleanPath(this.#options.appDir) : undefined;
    const routeConfig = await globalIt(
      `mockRoutes:${appDir}${JSON.stringify(routes)}`,
      () => initRoutes(routes, appDir),
    );
    const reqData = req.method === "GET" &&
      (url.searchParams.has("_data_") || req.headers.get("Accept") === "application/json");
    const res = await fetchRouteData(routeConfig.routes, url, req, ctx, reqData);
    if (res) {
      return res;
    }

    const indexHtml = await globalIt(`mockIndexHtml:${appDir}`, () =>
      loadAndFixIndexHtml({
        ssr: typeof ssr === "function" ? {} : ssr,
        isDev: false,
        appDir,
      }));

    return renderer.fetch(req, ctx, {
      indexHtml,
      routeConfig,
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
