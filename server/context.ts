import type { ConnInfo } from "https://deno.land/std@0.140.0/http/server.ts";
import util from "../lib/util.ts";
import type { HTMLRewriterHandlers } from "./html.ts";
import { type CookieOptions, setCookieHeader } from "./response.ts";

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
        options?.session ?? {
          storage: new MemorySessionStorage(),
        },
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

export interface SessionStorage {
  get(sid: string): Promise<unknown | undefined>;
  set(sid: string, data: unknown, expires: number): Promise<void>;
  delete(sid: string): Promise<void>;
}

export class MemorySessionStorage implements SessionStorage {
  #store: Map<string, [unknown, number]> = new Map();

  get(sid: string): Promise<unknown | undefined> {
    const [data, expires] = this.#store.get(sid) ?? [undefined, 0];
    if (expires > 0 && Date.now() > expires) {
      this.#store.delete(sid);
      return Promise.resolve(undefined);
    }
    return Promise.resolve(data);
  }

  set(sid: string, data: unknown, expires: number): Promise<void> {
    this.#store.set(sid, [data, expires]);
    return Promise.resolve();
  }

  delete(sid: string): Promise<void> {
    this.#store.delete(sid);
    return Promise.resolve();
  }
}

export interface SessionCookieOptions {
  name?: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
}

export interface SessionOptions {
  storage: SessionStorage;
  cookie?: SessionCookieOptions;
  secret?: string;
  maxAge?: number;
}

export class SessionImpl<StoreType extends Record<string, unknown>> {
  #id: string;
  #options: SessionOptions;
  #store: StoreType | undefined;

  constructor(id: string, options: SessionOptions) {
    this.#id = id;
    this.#options = options;
  }

  get id(): string {
    return this.#id;
  }

  get store(): StoreType | undefined {
    return this.#store;
  }

  async read(): Promise<void> {
    this.#store = (await this.#options.storage.get(this.#id)) as StoreType | undefined;
  }

  async update(store: StoreType | ((prev: StoreType | undefined) => StoreType)): Promise<string> {
    if (typeof store !== "object" && typeof store !== "function") {
      throw new Error("store must be a valid object or a function");
    }

    let nextStore: StoreType | undefined;
    if (typeof store === "function") {
      nextStore = store(this.#store);
    } else {
      nextStore = store;
    }

    await this.#options.storage.set(this.#id, nextStore, Date.now() + 1000 * (this.#options.maxAge ?? 1800));
    this.#store = nextStore;
    return setCookieHeader(
      this.#options.cookie?.name ?? "session",
      this.#id,
      {
        ...this.#options.cookie,
        expires: new Date(Date.now() + 1000 * (this.#options.maxAge ?? 1800)),
      },
    );
  }

  async end(): Promise<string> {
    await this.#options.storage.delete(this.#id);
    this.#store = undefined;
    return setCookieHeader(
      this.#options.cookie?.name ?? "session",
      "",
      {
        ...this.#options.cookie,
        expires: new Date(0),
      },
    );
  }
}
