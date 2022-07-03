import util from "../lib/util.ts";
import { setCookieHeader } from "./helpers.ts";
import { SessionImpl } from "./session.ts";
import type { ConnInfo, Context, CookieOptions, HTMLRewriterHandlers, Session, SessionOptions } from "./types.ts";

type ContextOptions = {
  connInfo?: ConnInfo;
  customHTMLRewriter?: [selector: string, handlers: HTMLRewriterHandlers][];
  session?: SessionOptions;
};

/** create a context object */
export function createContext(req: Request, options?: ContextOptions): Context {
  let cookies: Map<string, string> | null = null;
  let session: Session<Record<string, unknown>> | null = null;
  const ctx: Context = {
    connInfo: options?.connInfo,
    params: {},
    headers: new Headers(),
    cookies: {
      get(name: string) {
        if (cookies === null) {
          cookies = new Map<string, string>();
          const cookieHeader = req.headers.get("Cookie");
          if (cookieHeader) {
            for (const cookie of cookieHeader.split(";")) {
              const [key, value] = util.splitBy(cookie, "=");
              cookies.set(key.trim(), value);
            }
          }
        }
        return cookies.get(name);
      },
      set(name: string, value: string, options?: CookieOptions) {
        cookies?.set(name, value);
        ctx.headers.set("Set-Cookie", setCookieHeader(name, value, options));
      },
      delete(name: string, options?: CookieOptions) {
        cookies?.delete(name);
        ctx.headers.set("Set-Cookie", setCookieHeader(name, "", { ...options, expires: new Date(0) }));
      },
    },
    // deno-lint-ignore ban-ts-comment
    // @ts-ignore
    async getSession(): Promise<Session<Record<string, unknown>>> {
      if (session !== null) {
        return session;
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

      const sessionImpl = new SessionImpl<Record<string, unknown>>(
        sid,
        options?.session,
      );
      await sessionImpl.read();
      session = sessionImpl;
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
