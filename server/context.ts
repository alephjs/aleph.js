import { computeHash, hmacSign, splitBy } from "../shared/util.ts";
import { SessionImpl } from "./session.ts";
import type { ConnInfo, Context, HTMLRewriterHandlers, Session, SessionOptions } from "./types.ts";

type ContextOptions = {
  connInfo?: ConnInfo;
  session?: SessionOptions;
};

/** create a context object */
export function createContext(
  req: Request,
  next: () => Promise<Response> | Response,
  options?: ContextOptions,
): Context {
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
      if (session !== null) {
        return session;
      }

      const cookieName = options?.session?.cookie?.name ?? "session";
      const secret = options?.session?.secret ?? "-";
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

      const sessionImpl = new SessionImpl<Record<string, unknown>>(
        sid,
        options?.session,
      );
      session = sessionImpl;
      if (!skipInit) {
        await sessionImpl.init();
      }
      return session;
    },
    __htmlRewriterHandlers: [],
    htmlRewriter: {
      on: (selector: string, handlers: HTMLRewriterHandlers) => {
        (ctx.__htmlRewriterHandlers as unknown[]).push([selector, handlers]);
      },
    },
    next,
  };
  return ctx;
}
