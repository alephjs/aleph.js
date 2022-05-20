/** Information about the connection a request arrived on. */
interface ConnInfo {
  /** The local address of the connection. */
  readonly localAddr: Deno.Addr;
  /** The remote address of the connection. */
  readonly remoteAddr: Deno.Addr;
}

interface CookieOptions {
  expires?: number | Date;
  maxAge?: number;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
}

interface Cookies {
  get(key: string): string | undefined;
  set(key: string, value: string, options?: CookieOptions): void;
  delete(key: string, options?: CookieOptions): void;
}

interface HTMLRewriterHandlers {
  element?: (element: import("https://deno.land/x/lol_html@0.0.3/types.d.ts").Element) => void;
  comments?: (comment: import("https://deno.land/x/lol_html@0.0.3/types.d.ts").Comment) => void;
  text?: (text: import("https://deno.land/x/lol_html@0.0.3/types.d.ts").TextChunk) => void;
}

interface HTMLRewriter {
  on: (selector: string, handlers: HTMLRewriterHandlers) => void;
}

declare interface Context extends Record<string, unknown> {
  readonly connInfo: ConnInfo;
  readonly params: Record<string, string>;
  readonly headers: Headers;
  readonly cookies: Cookies;
  readonly htmlRewriter: HTMLRewriter;
}

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

declare interface Middleware {
  readonly name?: string;
  readonly eager?: boolean;
  fetch(
    request: Request,
    context: Context,
  ): Promise<Response | CallableFunction | void> | Response | CallableFunction | void;
}

declare interface ImportMeta {
  readonly hot?: {
    watchFile: (filename: string, callback: () => void) => () => void;
    accept: (callback?: (module: unknown) => void) => void;
    decline: (delay?: number) => void;
  };
}
