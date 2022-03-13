import type { UserConfig as AtomicCSSConfig } from "https://esm.sh/@unocss/core@0.28.0";
import type { URLPatternCompat, URLPatternInput } from "../lib/url.ts";

export type AlephConfig = {
  atomicCSS?: AtomicCSSConfig;
  basePath?: string;
  build?: BuildOptions;
  routeFiles?: string | RoutesConfig;
};

export type ModuleLoader = {
  test(pathname: string): boolean;
  load(pathname: string, env: ModuleLoaderEnv): Promise<ModuleLoaderContent> | ModuleLoaderContent;
};

export type ModuleLoaderEnv = {
  importMap?: ImportMap;
  isDev?: boolean;
  ssr?: boolean;
};

export type ModuleLoaderContent = {
  code: string;
  inlineCSS?: string;
  lang?: "js" | "jsx" | "ts" | "tsx" | "css";
  map?: string;
  modtime?: number;
};

export type BuildOptions = {
  /** The output directory. default is "dist" */
  outputDir?: string;
  /** build target */
  target?: "es2015" | "es2016" | "es2017" | "es2018" | "es2019" | "es2020" | "es2021" | "es2022";
};

export type RoutesConfig = {
  dir: string;
  exts: string[];
  host?: boolean;
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

export type RouteMeta = {
  filename: string;
  pattern: URLPatternInput;
  nesting?: boolean;
};

export type Route = readonly [
  pattern: URLPatternCompat,
  meta: RouteMeta,
];

export type ImportMap = {
  readonly __filename: string;
  readonly imports: Record<string, string>;
  readonly scopes: Record<string, Record<string, string>>;
};

export type JSXConfig = {
  jsxRuntime?: "react" | "preact";
  jsxImportSource?: string;
  jsxRuntimeVersion?: string;
  jsxRuntimeCdnVersion?: string;
};

export { AtomicCSSConfig };
