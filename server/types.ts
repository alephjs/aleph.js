import type { UserConfig as AtomicCSSConfig } from "https://esm.sh/@unocss/core@0.27.2";
import type { URLPatternCompat, URLPatternInput } from "../lib/url.ts";

export type AlephConfig = {
  atomicCSS?: AtomicCSSConfig;
  basePath?: string;
  build?: BuildOptions;
  routeFiles?: string | RoutesConfig;
};

export type ImportMap = {
  readonly imports: Record<string, string>;
  readonly scopes: Record<string, Record<string, string>>;
};

export type RoutesConfig = {
  dir: string;
  exts: string[];
  host?: boolean;
};

export type BuildOptions = {
  /** The output directory. default: "dist" */
  outputDir?: string;
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

export type FetchHandler = {
  (request: Request, context: Record<string, unknown>): Promise<Response> | Response;
};

export type MiddlewareHandler = {
  (request: Request, context: Record<string, unknown>): Promise<Response | void> | Response | void;
};

export interface Middleware {
  fetch: MiddlewareHandler;
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
  ssr?: (ctx: SSRContext) => string | Promise<string>;
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
