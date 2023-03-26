type CTX = import("./server/types.ts").Context;
// deno-lint-ignore no-empty-interface
declare interface Context extends CTX {}

/** The Middleare for Aleph server. */
declare interface Middleware {
  /** The middleware name. */
  readonly name?: string;
  /** The middleware fetch method. */
  fetch(request: Request, context: Context): Promise<Response> | Response;
}

declare interface ImportMeta {
  /** Aleph.js HMR `hot` API. */
  readonly hot?: {
    readonly data: Record<string, unknown>;
    accept<T = Record<string, unknown>>(callback?: (module: T) => void): void;
    decline(): void;
    dispose: (callback: (data: Record<string, unknown>) => void) => void;
    invalidate(): void;
    watchFile(filename: string, callback: () => void): () => void;
  };
}
