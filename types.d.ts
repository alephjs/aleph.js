declare type HTMLRewriterHandlers = {
  element?: (element: import("https://deno.land/x/lol_html@0.0.3/types.d.ts").Element) => void;
  text?: (text: import("https://deno.land/x/lol_html@0.0.3/types.d.ts").TextChunk) => void;
  doctype?: (doctype: import("https://deno.land/x/lol_html@0.0.3/types.d.ts").Doctype) => void;
  comments?: (comment: import("https://deno.land/x/lol_html@0.0.3/types.d.ts").Comment) => void;
  end?: (end: import("https://deno.land/x/lol_html@0.0.3/types.d.ts").DocumentEnd) => void;
};

declare interface Context extends Record<string, unknown> {
  readonly params: Record<string, string>;
  readonly HTMLRewriter: {
    on: (selector: string, handlers: HTMLRewriterHandlers) => void;
  };
}

declare interface Data {
  get?(request: Request, context: Context): Promise<Response> | Response;
  post?(request: Request, context: Context): Promise<Response> | Response;
  put?(request: Request, context: Context): Promise<Response> | Response;
  patch?(request: Request, context: Context): Promise<Response> | Response;
  delete?(request: Request, context: Context): Promise<Response> | Response;
}

type MiddlewareCallback = () => Promise<void> | void;

declare interface Middleware {
  fetch(
    request: Request,
    context: Context,
  ): Promise<Response | MiddlewareCallback | void> | Response | MiddlewareCallback | void;
}

declare interface ImportMeta {
  readonly hot?: {
    accept: (callback?: (module: unknown) => void) => void;
    decline: () => void;
  };
}
