declare type HTMLRewriterHandlers = {
  element?: (element: import("https://deno.land/x/lol_html@0.0.2/types.d.ts").Element) => void;
  text?: (text: import("https://deno.land/x/lol_html@0.0.2/types.d.ts").TextChunk) => void;
  doctype?: (doctype: import("https://deno.land/x/lol_html@0.0.2/types.d.ts").Doctype) => void;
  comments?: (comment: import("https://deno.land/x/lol_html@0.0.2/types.d.ts").Comment) => void;
  end?: (end: import("https://deno.land/x/lol_html@0.0.2/types.d.ts").DocumentEnd) => void;
};

declare interface FetchContext extends Record<string, unknown> {
  readonly params: Record<string, string>;
  readonly HTMLRewriter: {
    on: (selector: string, handlers: HTMLRewriterHandlers) => void;
  };
}

declare interface ImportMeta {
  hot?: {
    accept: (callback?: (module: unknown) => void) => void;
    decline: () => void;
  };
}
