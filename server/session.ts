import { setCookieHeader } from "./helpers.ts";

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

const defaultSessionStorage = new MemorySessionStorage();

export interface SessionCookieOptions {
  name?: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
}

export interface SessionOptions {
  storage?: SessionStorage;
  cookie?: SessionCookieOptions;
  secret?: string;
  maxAge?: number;
}

export class SessionImpl<StoreType extends Record<string, unknown>> {
  #id: string;
  #options: SessionOptions;
  #store: StoreType | undefined;
  #storage: SessionStorage;

  constructor(id: string, options: SessionOptions = {}) {
    this.#id = id;
    this.#options = options;
    this.#storage = options.storage ?? defaultSessionStorage;
  }

  get id(): string {
    return this.#id;
  }

  get store(): StoreType | undefined {
    return this.#store;
  }

  async read(): Promise<void> {
    this.#store = (await this.#storage.get(this.#id)) as StoreType | undefined;
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

    await this.#storage.set(this.#id, nextStore, Date.now() + 1000 * (this.#options.maxAge ?? 1800));
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
    await this.#storage.delete(this.#id);
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
