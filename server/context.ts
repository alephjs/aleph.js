import type { ConnInfo } from "https://deno.land/std@0.136.0/http/server.ts";
import util from "../lib/util.ts";
import { type CookieOptions, setCookieHeader } from "./response.ts";
import type { HTMLRewriterHandlers } from "./html.ts";

type Options = {
  connInfo?: ConnInfo;
  customHTMLRewriter?: [string, HTMLRewriterHandlers][];
};

export function createContext(req: Request, options?: Options): typeof ctx {
  // create the context object
  const ctx = {
    connInfo: options?.connInfo,
    params: {},
    headers: new Headers(),
    cookies: {
      _cookies: null as Map<string, string> | null,
      get(name: string) {
        if (this._cookies === null) {
          this._cookies = new Map<string, string>();
          const cookieHeader = req.headers.get("Cookie");
          if (cookieHeader) {
            for (const cookie of cookieHeader.split(";")) {
              const [key, value] = util.splitBy(cookie, "=");
              this._cookies.set(key.trim(), value);
            }
          }
        }
        return this._cookies.get(name);
      },
      set(name: string, value: string, options?: CookieOptions) {
        this._cookies?.set(name, value);
        ctx.headers.set("Set-Cookie", setCookieHeader(name, value, options));
      },
      delete(name: string, options?: CookieOptions) {
        this._cookies?.delete(name);
        ctx.headers.set("Set-Cookie", setCookieHeader(name, "", { ...options, expires: new Date(0) }));
      },
    },
    htmlRewriter: {
      on: (selector: string, handlers: HTMLRewriterHandlers) => {
        options?.customHTMLRewriter?.push([selector, handlers]);
      },
    },
  };

  return ctx;
}
