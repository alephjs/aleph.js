/**
 * The config for aleph app.
 */
export type Config = {
  /** `framework` specifies the framework (default is 'react'). */
  framework?: 'react'
  /** `basePath` specifies the path prefix (default is '/'). */
  basePath?: string
  /** `defaultLocale` specifies the default locale (default is '**en**'). */
  defaultLocale?: string
  /** `locales` specifies the available locales. */
  locales?: string[]
  /** `build` specifies the options for **ES Build**. */
  build?: BuildOptions
  /** `ssr` specifies the options for **SSR**. */
  ssr?: boolean | GlobalSSROptions
  /** `server` specifies the options for **Server**. */
  server?: ServerOptions
  /** `css` specifies the css processing options. */
  css?: CSSOptions
  /** `plugins` specifies some plugins to extend Aleph runtime. */
  plugins?: Plugin[]
  /** `env` appends system env variables. */
  env?: Record<string, string>
}

/**
 * An interface that aligns to the parts of the `Aleph`.
 */
export interface Aleph {
  readonly mode: 'development' | 'production'
  readonly workingDir: string
  readonly buildDir: string
  readonly config: Required<Config>
  readonly importMap: ImportMap
  addModuleLoader(loader: ModuleLoader): void
  addModule(specifier: string, sourceCode?: string): Promise<void>
  addDist(path: string, content: Uint8Array): Promise<void>
  fetchModule(specifier: string): Promise<{ content: Uint8Array, contentType: string | null }>
  injectCode(phase: 'compilation' | 'hmr' | 'ssr', test: RegExp | string, transform: (specifier: string, code: string, map?: string) => { code: string, map?: string }): void
  injectCode(phase: 'compilation' | 'hmr' | 'ssr', transform: (specifier: string, code: string, map?: string) => { code: string, map?: string }): void
}

/**
 * The module loader to load source media.
 */
export type ModuleLoader = {
  /** `test` matches the module specifier. */
  test: RegExp
  /** `acceptHMR` enables the HMR. */
  acceptHMR?: boolean
  /** allowPage` allows to load the module as a page. */
  allowPage?: boolean
  /** `resove` resolves the module specifier. */
  resolve?(specifier: string): ResolveResult
  /** `load` loads the source content. */
  load?(input: { specifier: string, data?: any }, aleph: Aleph): LoaderOutput | Promise<LoaderOutput>
}

/**
 * The plugin to enhance aleph runtime.
 */
export type Plugin = {
  /** `name` gives the plugin a name. */
  name: string
  /** `setup` setups the plugin. */
  setup(aleph: Aleph): Promise<void> | void
}

/**
 * The result of module loader's `resolve` method.
 */
export type ResolveResult = {
  specifier: string,
  external?: boolean,
  pagePath?: string,
  isIndex?: boolean
  data?: any,
}

/**
 * The output of module loader's `load` method.
 */
export type LoaderOutput = {
  /** The transformed code type (default is 'js'). */
  type?: 'css' | 'js' | 'jsx' | 'ts' | 'tsx'
  /** The transformed code. */
  code: string
  /** The source map. */
  map?: string
}

/**
 * The built target of esbuild.
 */
export type BuildTarget = 'es2015' | 'es2016' | 'es2017' | 'es2018' | 'es2019' | 'es2020' | 'es2021' | 'esnext'

/**
 * The supported borwser name of esbuild.
 */
export type BrowserName = 'chrome' | 'edge' | 'firefox' | 'ios' | 'safari'

/**
 * The config for ES Build.
 */
export type BuildOptions = {
  /** `target` specifies the build target in production mode (default is [**es2015**]). */
  target?: BuildTarget
  /** `browsers` specifies the target browsers for esbuild. */
  browsers?: Record<BrowserName, number>
  /** `outputDir` specifies the output directory for `build` command (default is '**dist**'). */
  outputDir?: string
}

/**
 * The import maps.
 */
export type ImportMap = {
  imports: Record<string, string>
  scopes: Record<string, Record<string, string>>
}

/**
 * The config for builtin CSS loader.
 */
export type CSSOptions = {
  /** `cache` caches remote css to local if it is true. */
  cache?: boolean
  /** `extract` specifies the extract options (default is true with 8k limit). */
  extract?: boolean | { limit?: number }
  /** `postcss` specifies the postcss plugins. */
  postcss?: { plugins: PostCSSPlugin[] }
  /** `modules` specifies CSS modules behavior. */
  modules?: CSSModulesOptions
}

/**
 * The plugin type of postcss.
 */
export type PostCSSPlugin = string | [string, any] | Record<string, any> | CallableFunction

/**
 * The options are passed on to postcss-modules.
 */
export type CSSModulesOptions = {
  exportGlobals?: boolean
  generateScopedName?: string | ((name: string, filename: string, css: string) => string)
  globalModulePaths?: string[]
  hashPrefix?: string
  localsConvention?: 'camelCase' | 'camelCaseOnly' | 'dashes' | 'dashesOnly'
  scopeBehaviour?: 'global' | 'local'
}

/**
 * Global **SSR** options.
 */
export type GlobalSSROptions = {
  /** A list of RegExp for paths to use **SSR**. */
  include?: RegExp[]
  /** A list of RegExp for paths to skip **SSR**. */
  exclude?: RegExp[]
}

/**
 * The **SSR** props.
 */
export type SSRProps = {
  [key: string]: any
  $revalidate?: number
}

/**
 * The **SSR** options for pages.
 */
export type SSROptions = {
  props?(router: RouterURL): (SSRProps | Promise<SSRProps>)
  paths?(): (string[] | Promise<string[]>)
}

/**
 * The options for Server.
 */
export type ServerOptions = {
  /** A list of `APIMiddleware` for api requests. */
  middlewares?: APIMiddleware[]
  /** `headers` appends custom headers for server requests. */
  headers?: Record<string, string>
  /** `rewrites` specifies the server rewrite map. */
  rewrites?: Record<string, string>
  /** `compress` enbles compression(gzip/brotli) for static files and SSR content (default is **true**). */
  compress?: boolean
}

/**
 * The handler for API requests.
 */
export type APIHandler = {
  (context: APIContext): Promise<void> | void
}

/**
 * The middleware for API requests.
 */
export type APIMiddleware = {
  (context: APIContext, next: () => void): Promise<void> | void
}

/**
 * An interface that aligns to the `Deno.RequestEvent`
 */
export interface APIContext extends Deno.RequestEvent {
  /** The data handled by middlewares. */
  readonly data: Map<string, any>
  /** An interface that aligns to the parts of the `Response` with helper methods */
  readonly response: APIResponse
  /** The router by the api routing. */
  readonly router: RouterURL
}

/**
 * An interface that aligns to the parts of the `Response` with helpers.
 */
export interface APIResponse {
  status: number
  headers: Headers
  body?: string | Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>
  /**
  * `addHeader` adds a new value onto an existing response header of the request, or
  * adds the header if it does not already exist.
  */
  addHeader(key: string, value: string): this
  /**
   * `setHeader` sets a new value for an existing response header of the request, or adds
   * the header if it does not already exist.
   */
  setHeader(key: string, value: string): this
  /** `removeHeader` removes the value for an existing response header of the request. */
  removeHeader(key: string): this
  /** `redirect` replies to redirect the client to another URL with optional response `status` defaulting to 302. */
  redirect(url: string, status?: number): this
  /** `json` replies to the request with a json content. */
  json(data: any, space?: string | number): this
}

/**
 * The router URL object of the routing.
 */
export type RouterURL = {
  readonly basePath: string
  readonly routePath: string
  readonly locale: string
  readonly defaultLocale: string
  readonly locales: string[]
  readonly pathname: string
  readonly params: Record<string, string>
  readonly query: URLSearchParams
  toString(): string
  push(url: string): void
  replace(url: string): void
}
