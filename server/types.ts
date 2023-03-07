import type { ConnInfo, ServeInit } from "https://deno.land/std@0.175.0/http/server.ts";
import type { Comment, Element, TextChunk } from "https://deno.land/x/lol_html@0.0.6/types.d.ts";
import type { RouteModule } from "../framework/core/routes.ts";

export type AlephConfig = {
  /** The base url of the server. */
  baseUrl?: string;
  /** The TLS options. */
  tls?: TLSOptions;
  /** The router options for the file-system based routing. */
  router?: RouterInit;
  /** The module loaders. */
  loaders?: ModuleLoader[];
  /** The server middlewares. */
  middlewares?: Middleware[];
  /** The options for session. */
  session?: SessionOptions;
  /** The options for SSR. */
  ssr?: SSR;
  /** The options for build. */
  build?: BuildOptions;
  /** The atomic CSS engine. */
  atomicCSS?: AtomicCSSEngine;
  /** The plugins. */
  plugins?: Plugin[];
  /** The error handler. */
  onError?: ErrorHandler;
};

export interface Plugin {
  name?: string;
  setup(config: AlephConfig): void | Promise<void>;
}

export interface AtomicCSSGenerateOptions {
  /**
   * Filepath of the file being processed.
   */
  id?: string;
  /**
   * Generate preflights (if defined)
   *
   * @default true
   */
  preflights?: boolean;
  /**
   * Generate minified CSS
   * @default false
   */
  minify?: boolean;
}

export interface AtomicCSSGenerateResult {
  css: string;
  matched: Set<string>;
}

export interface AtomicCSSEngine {
  name?: string;
  version?: string;
  test?: RegExp;
  resetCSS?: string;
  generate(input: string | string[], options?: AtomicCSSGenerateOptions): Promise<AtomicCSSGenerateResult>;
}

/** The router options for the file-system based routing. */
export interface RouterInit {
  /** The base url of the router. Dafault is `/` */
  basePath?: string;
  /** The glob to match routes.  */
  glob?: string;
  /** The directory of the FS routing. Default is `./routes` */
  dir?: string;
  /** The extnames to match routes. */
  exts?: string[];
  /** The pre-built routes.  */
  routes?: Record<string, Record<string, unknown>>;
}

export type CookieOptions = {
  expires?: number | Date;
  maxAge?: number;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
};

export interface Cookies {
  get(key: string): string | undefined;
}

export interface SessionStorage {
  get(sid: string): Promise<Record<string, unknown> | undefined>;
  set(sid: string, data: Record<string, unknown>, expires: number): Promise<void>;
  delete(sid: string): Promise<void>;
}

export type SessionCookieOptions = {
  name?: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
};

export type SessionOptions = {
  storage?: SessionStorage;
  cookie?: SessionCookieOptions;
  secret?: string;
  maxAge?: number;
};

export interface Session<T> {
  store: T | undefined;
  update(store: T | ((store: T | undefined) => T)): Promise<void>;
  end(): Promise<void>;
  redirect(url: string | URL): Response;
}

export interface HTMLRewriterHandlers {
  element?: (element: Element) => void;
  comments?: (comment: Comment) => void;
  text?: (text: TextChunk) => void;
}

export interface HTMLRewriter {
  on: (selector: string, handlers: HTMLRewriterHandlers) => void;
}

export interface Context extends Record<string, unknown> {
  /** The request connection info. */
  readonly connInfo?: ConnInfo;
  /** The params of dynamic routes. */
  readonly params: Record<string, string>;
  /** The cookies from client. */
  readonly cookies: Cookies;
  /** The HtmlRewriter to rewrite the html output. */
  readonly htmlRewriter: HTMLRewriter;
  /** Returns the `Session` object. */
  getSession: <T extends Record<string, unknown> = Record<string, unknown>>() => Promise<Session<T>>;
  /** Returns the next `Response` object. */
  next: () => Promise<Response> | Response;
}

/** The Middleare for Aleph server. */
export interface Middleware {
  /** The middleware name. */
  readonly name?: string;
  /** The middleware fetch method. */
  fetch(request: Request, context: Context): Promise<Response> | Response;
}

export type ImportMap = {
  readonly __filename: string;
  readonly imports: Record<string, string>;
  readonly scopes: Record<string, Record<string, string>>;
};

export type JSXConfig = {
  jsxPragma?: string;
  jsxPragmaFrag?: string;
  jsxImportSource?: string;
};

export type ModuleLoaderEnv = {
  isDev?: boolean;
  importMap?: ImportMap;
  jsxConfig?: JSXConfig;
  sourceMap?: boolean;
  spaMode?: boolean;
  ssr?: boolean;
};

export type ModuleLoaderOutput = {
  code: string;
  inlineCSS?: string;
  lang?: "js" | "jsx" | "ts" | "tsx";
  map?: string;
};

export interface ModuleLoader {
  test(path: string): boolean;
  load(specifier: string, content: string, env: ModuleLoaderEnv): Promise<ModuleLoaderOutput> | ModuleLoaderOutput;
}

/** The optimization options for the server. */
export type BuildOptions = {
  /** The output directory, default is "./out". */
  outputDir?: string;
  /** The built target for esbuild, default is "es2018". */
  buildTarget?: "es2015" | "es2016" | "es2017" | "es2018" | "es2019" | "es2020" | "es2021" | "es2022";
  /** The SSG options for the FS routing. */
  ssg?: boolean | SSGOptions;
  /** The source map options for esbuild. */
  sourceMap?: boolean;
};

/** The SSG options for the FS routing. */
export type SSGOptions = {
  include?: RegExp;
  exclude?: RegExp;
  getStaticPaths?: () => string[] | Promise<string[]>;
  clientHeaders?: HeadersInit;
};

export type SSRContext = {
  readonly url: URL;
  readonly modules: RouteModule[];
  readonly headCollection: string[];
  readonly signal: AbortSignal;
  readonly nonce?: string;
  setStatus(code: number): void;
  setSuspenseMarker(selector: string, test: (el: Element) => boolean): void;
};

export type SuspenseMarker = {
  selector: string;
  test: (el: Element) => boolean;
};

export type SSRFn = {
  (ssr: SSRContext): Promise<ReadableStream | string> | ReadableStream | string;
};

/**
 * Options for the content-security-policy.
 * https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy
 */
export type CSP = {
  nonce?: boolean;
  getPolicy: (url: URL, nonce?: string) => string | null;
};

export type SSROptions = {
  /** The selector of root to append SSR ouput, default is "#root". */
  root?: string;
  include?: RegExp | RegExp[];
  exclude?: RegExp | RegExp[];
  /**
   * Options for the content-security-policy.
   * https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy
   */
  CSP?: CSP;
};

export type SSR =
  | SSRFn
  | SSROptions & {
    render: SSRFn;
  };

export type ErrorHandler = {
  (
    error: unknown,
    cause: "route-data-fetch" | "ssr" | "transform" | "fs" | "middleware",
    request: Request,
    context: Context,
  ): Response | void;
};

export type TLSOptions = {
  certFile: string;
  keyFile: string;
};

export type { ConnInfo, ServeInit };
