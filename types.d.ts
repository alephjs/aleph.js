declare const __aleph: {
  // deno-lint-ignore no-explicit-any
  importRouteModule(url: string): Promise<any>;
  // deno-lint-ignore no-explicit-any
  getRouteModule(url: string): any;
};

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
