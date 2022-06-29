import type { UserConfig as UnoConfig } from "../lib/@unocss/core.ts";

export type AlephConfig = {
  appDir?: string;
  /** The config for file-system based routing.  */
  routes?: string;
  /** The pre-imported modules of FS routing,  */
  routeModules?: Record<string, Record<string, unknown>>;
  /** The build options for `build` command. */
  build?: BuildOptions;
  /** The config for UnoCSS. */
  unocss?: UnoConfig & { test?: RegExp };
  /* The cache storage for transformer/ssr */
  caches?: CacheStorage;
  /** The config for dev server. */
  devServer?: {
    /** The handler for fs watch event */
    watchFS?: (kind: "create" | "remove" | "modify", specifier: string) => void;
    /** The url for HMR web socket. This is useful for dev server proxy mode. */
    hmrWebSocketUrl?: string;
  };
};

/** The build platform.  */
export type BuildPlatform = "deno" | "cloudflare" | "vercel";

/** The build options for `build` command. */
export type BuildOptions = {
  /** The supported platform. default is "deno" */
  platform?: BuildPlatform;
  /** The build target passes to esbuild. default is "es2020" */
  target?: "es2015" | "es2016" | "es2017" | "es2018" | "es2019" | "es2020" | "es2021" | "es2022";
  /** The directory for build output files. default is "dist" */
  outputDir?: string;
};

export interface FetchHandler {
  (request: Request, context: Record<string, unknown>): Promise<Response> | Response;
}

export interface Middleware {
  name?: string;
  eager?: boolean;
  fetch(
    request: Request,
    context: Record<string, unknown>,
  ): Promise<Response | (() => void) | void> | Response | (() => void) | void;
}

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

export type ModuleLoaderEnv = {
  importMap?: ImportMap;
  isDev?: boolean;
  ssr?: boolean;
};

export type ModuleLoaderOutput = {
  code: string;
  inlineCSS?: string;
  lang?: "js" | "jsx" | "ts" | "tsx" | "css";
  isTemplateLanguage?: boolean;
  map?: string;
};

export interface ModuleLoader {
  test(pathname: string): boolean;
  load(specifier: string, content: string, env: ModuleLoaderEnv): Promise<ModuleLoaderOutput> | ModuleLoaderOutput;
}

export { UnoConfig };
