import { computeHash, hmacSign, splitBy } from "../shared/util.ts";
import { SessionImpl } from "./session.ts";
import type { ConnInfo, Context, HTMLRewriterHandlers, Session, SessionOptions } from "./types.ts";

export const NEXT = Symbol();
export const CUSTOM_HTML_REWRITER = Symbol();

export type ContextInit = {
  req: Request;
  connInfo: ConnInfo;
  sessionOptions?: SessionOptions;
};

/** create a context object */
export function createContext(next: () => Promise<Response> | Response, init: ContextInit): Context {
  let cookies: Map<string, string> | null = null;
  let session: Session<Record<string, unknown>> | null = null;
  const customHtmlRewriter: [string, HTMLRewriterHandlers][] = [];
  const extension = {};
  const ctx: Context = {
    connInfo: init.connInfo,
    params: {},
    cookies: {
      get(name: string) {
        if (!cookies) {
          cookies = new Map<string, string>();
          const cookieHeader = init.req.headers.get("Cookie");
          if (cookieHeader) {
            for (const cookie of cookieHeader.split(";")) {
              const [key, value] = splitBy(cookie, "=");
              cookies.set(key.trim(), value);
            }
          }
        }
        return cookies.get(name);
      },
    },
    // deno-lint-ignore ban-ts-comment
    // @ts-ignore
    async getSession(): Promise<Session<Record<string, unknown>>> {
      if (session) {
        return session;
      }

      const { sessionOptions } = init;
      const cookieName = sessionOptions?.cookie?.name ?? "session";
      const secret = sessionOptions?.secret ?? "-";
      let sid = ctx.cookies.get(cookieName);
      let skipInit = false;
      if (sid) {
        const [rid, signature] = splitBy(sid, ".");
        if (!signature || signature !== await hmacSign(rid, secret, "SHA-256")) {
          sid = undefined;
        }
      }
      if (!sid) {
        const rid = await computeHash("SHA-1", crypto.randomUUID());
        sid = rid + "." + hmacSign(rid, secret);
        skipInit = true;
      }

      const sessionImpl = new SessionImpl<Record<string, unknown>>(sid, sessionOptions);
      session = sessionImpl;
      if (!skipInit) {
        await sessionImpl.init();
      }
      return session;
    },
    htmlRewriter: {
      on: (selector: string, handlers: HTMLRewriterHandlers) => {
        customHtmlRewriter.push([selector, handlers]);
      },
    },
    next,
  };
  return new Proxy(Object.create({}), {
    get(_target, prop) {
      if (prop === CUSTOM_HTML_REWRITER) {
        return customHtmlRewriter;
      }
      if (Reflect.has(ctx, prop)) {
        return Reflect.get(ctx, prop);
      }
      return Reflect.get(extension, prop);
    },
    set(_target, prop, value) {
      if (prop === NEXT) {
        Reflect.set(ctx, "next", value);
      }
      if (!Reflect.has(ctx, prop)) {
        return Reflect.set(extension, prop, value);
      }
      return false;
    },
    deleteProperty(_target, prop) {
      if (!Reflect.has(ctx, prop)) {
        return Reflect.deleteProperty(extension, prop);
      }
      return false;
    },
  });
}
