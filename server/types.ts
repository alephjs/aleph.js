import type { UserConfig as AtomicCSSConfig } from "https://esm.sh/@unocss/core@0.26.2";
import type { Comment, Doctype, DocumentEnd, Element, TextChunk } from "https://deno.land/x/lol_html@0.0.2/types.d.ts";
import type { URLPatternCompat, URLPatternInput } from "../lib/url.ts";

export type AlephConfig = {
  build?: BuildOptions;
  atomicCSS?: AtomicCSSConfig;
  routeFiles?: string | RoutesConfig;
};

export type RoutesConfig = {
  dir: string;
  exts: string[];
  host?: boolean;
};

export type BuildOptions = {
  target?: "es2015" | "es2016" | "es2017" | "es2018" | "es2019" | "es2020" | "es2021" | "es2022";
  ssg?: SSGOptions;
};

export type SSGOptions = {
  paths: () => Promise<string[]>;
};

export type JSXConfig = {
  jsxRuntime?: "react" | "preact";
  jsxImportSource?: string;
};

export type HTMLRewriterHandlers = {
  element?: (element: Element) => void;
  text?: (text: TextChunk) => void;
  doctype?: (doctype: Doctype) => void;
  comments?: (comment: Comment) => void;
  end?: (end: DocumentEnd) => void;
};

export interface FetchContext extends Record<string, unknown> {
  HTMLRewriter: {
    on: (selector: string, handlers: HTMLRewriterHandlers) => void;
  };
}

export type FetchHandler = {
  (request: Request, context: FetchContext): Promise<Response | void> | Response | void;
};

export interface Middleware {
  fetch: FetchHandler;
}

export type RenderModule = {
  url: URL;
  filename: string;
  error?: { message: string; status: number };
  redirect?: { headers: Headers; status: number };
  defaultExport?: unknown;
  data?: unknown;
  dataCacheTtl?: number;
};

export type SSRContext = {
  readonly url: URL;
  readonly modules: RenderModule[];
  readonly headCollection: string[];
};

export type ServerOptions = {
  port?: number;
  certFile?: string;
  keyFile?: string;
  hmrWebSocketUrl?: string;
  config?: AlephConfig;
  middlewares?: Middleware[];
  fetch?: FetchHandler;
  ssr?: (ctx: SSRContext) => string | undefined | Promise<string | undefined>;
};

export type RouteMeta = {
  filename: string;
  pattern: URLPatternInput;
  nesting?: boolean;
};

export type Route = readonly [
  pattern: URLPatternCompat,
  meta: RouteMeta,
];

export { AtomicCSSConfig };
