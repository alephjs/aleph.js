import type { UserConfig as UnoConfig } from "https://esm.sh/@unocss/core@0.32.12";

export type AlephConfig = {
  /** The basePath of the app. */
  basePath?: string;
  /** The build optioins for `build` command. */
  build?: BuildOptions;
  /** The config for file-system based routing.  */
  routes?: RoutesConfig | string;
  /** The config for atomic css powered by unocss. */
  unocss?: UnoConfig;
};

/** The build platform.  */
export type BuildPlatform = "deno" | "cloudflare" | "vercel";

/** The build optioins for `build` command. */
export type BuildOptions = {
  /** The supported platform. default is "deno" */
  platform?: BuildPlatform;
  /** The directory for build output files. default is "dist" */
  outputDir?: string;
  /** The build target passes to esbuild. default is "es2020" */
  target?: "es2015" | "es2016" | "es2017" | "es2018" | "es2019" | "es2020" | "es2021" | "es2022";
};

export type RoutesConfig = {
  glob: string;
  generate?: boolean;
  host?: boolean;
};

export type FetchHandler = {
  (request: Request): Promise<Response> | Response;
};

export interface Middleware {
  name?: string;
  version?: string;
  fetch(
    request: Request,
    context: Record<string, unknown>,
  ): Promise<Response | CallableFunction | void> | Response | CallableFunction | void;
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
  atomicCSS?: boolean;
  lang?: "js" | "jsx" | "ts" | "tsx" | "css";
  map?: string;
};

export { UnoConfig };
