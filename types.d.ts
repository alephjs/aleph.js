import type { UserConfig as AtomicCSSConfig } from "https://esm.sh/@unocss/core@0.26.0";

export type AlephConfig = {
  routeFiles?: string | RoutesConfig;
  build?: BuildOptions;
  atomicCSS?: AtomicCSSConfig;
};

export type RoutesConfig = {
  dir: string;
  exts: string[];
  host?: boolean;
};

export type BuildOptions = {
  target?: "es2015" | "es2016" | "es2017" | "es2018" | "es2019" | "es2020" | "es2021" | "es2022";
};

export type JSXConfig = {
  jsxRuntime?: "react" | "preact";
  jsxImportSource?: string;
};

export type FetchHandler = {
  (request: Request, context: Record<string, unknown>): Promise<Response | void> | Response | void;
};

export interface Middleware {
  fetch: FetchHandler;
}

export type SSRContext = {
  readonly url: URL;
  readonly headCollection: string[];
  readonly moduleDefaultExport?: unknown;
  readonly data?: unknown;
  readonly dataExpires?: number;
};

export type ServerOptions = {
  config?: AlephConfig;
  middlewares?: Middleware[];
  fetch?: FetchHandler;
  ssr?: (ctx: SSRContext) => string | undefined | Promise<string | undefined>;
};

export type RoutePattern = {
  host?: string;
  pathname: string;
};

export type RoutingRegExp = {
  prefix: string;
  test(filename: string): boolean;
  exec(filename: string): RoutePattern | null;
};

export interface IURLPattern {
  exec(input: { host?: string; pathname: string }): {
    [key in "host" | "pathname"]: { groups: Record<string, string> };
  };
}

export type Route = readonly [
  pattern: IURLPattern,
  loader: () => Promise<Record<string, unknown>>,
  meta: { filename: string; pattern: RoutePattern },
];

export { AtomicCSSConfig };
