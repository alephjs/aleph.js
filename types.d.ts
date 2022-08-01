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

declare interface Data<GetDataType = ResponseLike, ActionDataType = ResponseLike> {
  cacheTtl?: number;
  any?(request: Request, context: Context): Promise<Response | void> | Response | void;
  get?(
    request: Request,
    context: Context,
  ): Promise<GetDataType> | GetDataType;
  post?(request: Request, context: Context): Promise<ActionDataType> | ActionDataType;
  put?(request: Request, context: Context): Promise<ActionDataType> | ActionDataType;
  patch?(request: Request, context: Context): Promise<ActionDataType> | ActionDataType;
  delete?(request: Request, context: Context): Promise<ActionDataType> | ActionDataType;
}

declare function loaderImport(url: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;

declare interface ImportMeta {
  readonly hot?: {
    readonly data: Record<string, unknown>;
    accept<T = unknown>(callback?: (module: T) => void): void;
    decline(options?: { delay?: number }): void;
    dispose: (callback: (data: Record<string, unknown>) => void) => void;
    invalidate(): void;
    watchFile(filename: string, callback: () => void): () => void;
  };
}
