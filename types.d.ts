type HTMLRewriterHandlers = {
  element?: (element: import("https://deno.land/x/lol_html@0.0.3/types.d.ts").Element) => void;
  comments?: (comment: import("https://deno.land/x/lol_html@0.0.3/types.d.ts").Comment) => void;
  text?: (text: import("https://deno.land/x/lol_html@0.0.3/types.d.ts").TextChunk) => void;
};

type HTMLRewriter = {
  on: (selector: string, handlers: HTMLRewriterHandlers) => void;
};

declare type CookieOptions = {
  expires?: number | Date;
  maxAge?: number;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
};

declare interface Cookies {
  get(key: string): string | undefined;
  set(key: string, value: string, options?: CookieOptions): void;
  delete(key: string, options?: CookieOptions): void;
}

declare type CacheControlOptions = {
  maxAge?: number;
  sMaxAge?: number;
  public?: boolean;
  private?: boolean;
  immutable?: boolean;
  mustRevalidate?: boolean;
};

declare interface Context<DataType = unknown> extends Record<string, unknown> {
  readonly params: Record<string, string>;
  readonly headers: Headers;
  readonly cookies: Cookies;
  readonly htmlRewriter: HTMLRewriter;
  redirect(url: string | URL, code?: number): Response;
  json(data: DataType, init?: ResponseInit): Response;
  content(
    content: BodyInit,
    init?: ResponseInit & {
      contentType?: string;
      cacheControl?: "no-cache" | "immutable" | CacheControlOptions;
    },
  ): Response;
}

declare interface Data<DataType = unknown, ContextExtension = Record<never, never>> {
  cacheTtl?: number;
  any?(request: Request, context: Context & ContextExtension): Promise<Response | void> | Response | void;
  get?(request: Request, context: Context<DataType> & ContextExtension): Promise<Response> | Response;
  post?(request: Request, context: Context & ContextExtension): Promise<Response> | Response;
  put?(request: Request, context: Context & ContextExtension): Promise<Response> | Response;
  patch?(request: Request, context: Context & ContextExtension): Promise<Response> | Response;
  delete?(request: Request, context: Context & ContextExtension): Promise<Response> | Response;
}

declare interface Middleware {
  fetch(
    request: Request,
    context: Context,
  ): Promise<Response | CallableFunction | void> | Response | CallableFunction | void;
}

declare interface ImportMeta {
  readonly hot?: {
    watchFile: (filename: string, callback: () => void) => () => void;
    accept: (callback?: (module: unknown) => void) => void;
    decline: () => void;
  };
}
