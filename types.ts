/**
 * The config for aleph server.
 */
export type Config = {
  /** `framework` specifies the framework (default is 'react'). */
  framework?: 'react'
  /** `buildTarget` specifies the build target in production mode (default is [**es2015**]). */
  buildTarget?: BuildTarget
  /** `browserslist` specifies the target browsers for esbuild. */
  browserslist?: BrowsersList
  /** `basePath` specifies the path prefix for the application (default is '/'). */
  basePath?: string
  /** `srcDir` specifies the **src** dir (default is '/'). */
  srcDir?: string
  /** `outputDir` specifies the output directory for `build` command (default is '**dist**'). */
  outputDir?: string
  /** `defaultLocale` specifies the default locale of the application (default is '**en**'). */
  defaultLocale?: string
  /** `locales` specifies the available locales. */
  locales?: string[]
  /** `ssr` specifies the options for **SSR**. */
  ssr?: boolean | GloablSSROptions
  /** `plugins` specifies some plugins for the appliaction. */
  plugins?: (LoaderPlugin | ServerPlugin)[]
  /** `css` specifies the css processing options. */
  css?: CSSOptions
  /** `headers` appends custom headers for server requests. */
  headers?: Record<string, string>
  /** `rewrites` specifies the server rewrite map. */
  rewrites?: Record<string, string>
  /** `compress` enbles gzip/brotli compression for static files and SSR content (default is **true**). */
  compress?: boolean
  /** `env` appends system env variables. */
  env?: Record<string, string>
}

/**
 * The loader plugin to load source media.
 */
export type LoaderPlugin = {
  /** `type` specifies the plugin type. */
  type: 'loader'
  /** `name` gives the plugin a name. */
  name: string
  /** `test` matches the import specifier. */
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
 * The server plugin to enhance aleph runtime.
 */
export type ServerPlugin = {
  /** `type` specifies the plugin type. */
  type: 'server'
  /** `name` gives the plugin a name. */
  name: string
  /** `setup` setups the plugin. */
  setup(aleph: Aleph): Promise<void> | void
}

/**
 * The Plugin for postcss.
 */
export type PostCSSPlugin = string | [string, any] | Record<string, any> | CallableFunction

/**
 * The result of loader's resolve method.
 */
export type ResolveResult = {
  specifier: string,
  external?: boolean,
  pagePath?: string,
  isIndex?: boolean
  data?: any,
}

/**
 * The output of loader's load method.
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
 * The built target for build phase.
 */
export type BuildTarget = 'es2015' | 'es2016' | 'es2017' | 'es2018' | 'es2019' | 'es2020' | 'esnext'

/**
 * The borwser names for esbuild.
 */
export type BrowserNames = 'chrome' | 'edge' | 'firefox' | 'ios' | 'safari'

/**
 * The borwser names list for esbuild.
 */
export type BrowsersList = {
  [key in BrowserNames]?: number
}

/**
 * The import maps.
 */
export type ImportMap = {
  imports: Record<string, string>
  scopes: Record<string, Record<string, string>>
}

/**
 * The config for CSS loader.
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
export type GloablSSROptions = {
  /** A list of RegExp for paths to use **SSR**. */
  include?: RegExp[]
  /** A list of RegExp for paths to skip **SSR**. */
  exclude?: RegExp[]
}

/**
 * Page **SSR** options.
 */
export type SSROptions = {
  props?(router: RouterURL): ({ props: Record<string, any>, expires?: number } | Promise<{ props: Record<string, any>, expires?: number }>)
  paths?(): (string[] | Promise<string[]>)
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
  fetchModule(specifier: string): Promise<{ content: Uint8Array, contentType: string | null }>
  addModule(specifier: string, sourceCode?: string): Promise<void>
  addDist(path: string, content: Uint8Array): Promise<void>
  injectCode(phase: 'compilation' | 'hmr' | 'ssr', test: RegExp | string, transform: (specifier: string, code: string, map?: string) => { code: string, map?: string }): void
  injectCode(phase: 'compilation' | 'hmr' | 'ssr', transform: (specifier: string, code: string, map?: string) => { code: string, map?: string }): void
}

/**
 * An interface extends the `ServerRequest` for API requests.
 */
export interface APIRequest {
  readonly req: Request
  readonly router: RouterURL

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
  /** `status` sets response status of the request. */
  status(code: number): this
  /** `send` replies to the request with raw content. */
  send(data?: string | Uint8Array | ArrayBuffer, contentType?: string): Promise<void>
  /** `json` replies to the request with a json content. */
  json(data: any): Promise<void>
  /** `redirect` replies to redirect the client to another URL with optional response `status` defaulting to 302. */
  redirect(url: string, status?: number): this
}

/**
 * A handler to handle api requests.
 *
 * @param req APIRequest object
 */
export type APIHandler = {
  (req: APIRequest): void
}

/**
 * The router url object of the routing, you can access it with `useRouter()` hook.
 */
export type RouterURL = {
  readonly basePath: string
  readonly routePath: string
  readonly locale: string
  readonly pathname: string
  readonly params: Record<string, string>
  readonly query: URLSearchParams
  toString(): string
  push(url: string): void
  replace(url: string): void
}
