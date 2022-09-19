declare type Context = import("./server/types.ts").Context;
declare type Middleware = import("./server/types.ts").Middleware;

declare type ResponseLike =
  | Response
  | ReadableStream
  | ArrayBuffer
  | Uint8Array
  | string
  | Blob
  | File
  | Record<string, unknown>
  | Array<unknown>
  | null;

declare interface Data<DataType = ResponseLike, ActionDataType = ResponseLike> {
  defer?: boolean;
  cacheTtl?: number;
  any?(request: Request, context: Context): Promise<Response | void> | Response | void;
  get?(request: Request, context: Context): Promise<DataType> | DataType;
  post?(request: Request, context: Context): Promise<ActionDataType> | ActionDataType;
  put?(request: Request, context: Context): Promise<ActionDataType> | ActionDataType;
  patch?(request: Request, context: Context): Promise<ActionDataType> | ActionDataType;
  delete?(request: Request, context: Context): Promise<ActionDataType> | ActionDataType;
}

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
