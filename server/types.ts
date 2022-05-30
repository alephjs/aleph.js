import type { UserConfig as UnoConfig } from "https://esm.sh/@unocss/core@0.34.1";

export type AlephConfig = {
  /** The config for file-system based routing.  */
  routes?: RoutesConfig | string;
  /** The build options for `build` command. */
  build?: BuildOptions;
  /** The config for dev server. */
  devServer?: {
    watchFS?: (kind: "create" | "remove" | "modify", specifier: string) => void;
    /** The url for HMR web socket. This is useful for dev server proxy env. */
    hmrWebSocketUrl?: string;
  };
};

/** The build platform.  */
export type BuildPlatform = "deno" | "cloudflare" | "vercel";

/** The build options for `build` command. */
export type BuildOptions = {
  /** The supported platform. default is "deno" */
  platform?: BuildPlatform;
  /** The directory for build output files. default is "dist" */
  outputDir?: string;
  /** The build target passes to esbuild. default is "es2020" */
  target?: "es2015" | "es2016" | "es2017" | "es2018" | "es2019" | "es2020" | "es2021" | "es2022";
  /** The config for atomic css powered by unocss. */
  unocss?: UnoConfig;
};

export type RoutesConfig = {
  glob: string;
  generate?: boolean;
  host?: boolean;
};

export type FetchHandler = {
  (request: Request, context: Record<string, unknown>): Promise<Response> | Response;
};

export interface Middleware {
  name?: string;
  eager?: boolean;
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
  load(pathname: string, env: ModuleLoaderEnv): Promise<ModuleLoaderOutput> | ModuleLoaderOutput;
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

export { UnoConfig };
