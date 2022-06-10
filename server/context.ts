import type { ConnInfo } from "https://deno.land/std@0.142.0/http/server.ts";
import util from "../lib/util.ts";
import type { HTMLRewriterHandlers } from "./html.ts";
import { type CookieOptions, setCookieHeader } from "./helpers.ts";
import { SessionImpl, type SessionOptions } from "./session.ts";

type ContextOptions = {
  connInfo?: ConnInfo;
  customHTMLRewriter?: [selector: string, handlers: HTMLRewriterHandlers][];
  session?: SessionOptions;
};

export function createContext(req: Request, options?: ContextOptions): typeof ctx {
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
    _session: null as SessionImpl<Record<string, unknown>> | null,
    getSession: async function <StoreType extends Record<string, unknown> = Record<string, unknown>>() {
      if (ctx._session !== null) {
        return ctx._session;
      }

      const cookieName = options?.session?.cookie?.name ?? "session";
      let sid = ctx.cookies.get(cookieName);
      if (sid && options?.session?.secret) {
        const [rid, signature] = util.splitBy(sid, ".");
        if (!signature || signature !== await util.hmacSign(rid, options?.session?.secret, "SHA-256")) {
          sid = undefined;
        }
      }
      if (!sid) {
        sid = await util.computeHash("SHA-1", crypto.randomUUID());
        if (options?.session?.secret) {
          sid = sid + "." + util.hmacSign(sid, options.session.secret);
        }
      }

      const session = new SessionImpl<StoreType>(
        sid,
        options?.session,
      );
      await session.read();
      ctx._session = session as SessionImpl<Record<string, unknown>>;
      return session;
    },
    htmlRewriter: {
      on: (selector: string, handlers: HTMLRewriterHandlers) => {
        options?.customHTMLRewriter?.push([selector, handlers]);
      },
    },
  };

  return ctx;
}
