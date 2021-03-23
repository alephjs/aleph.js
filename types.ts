import type { BufReader, BufWriter } from 'std/io/bufio.ts'
import type { MultipartFormData } from 'std/mime/multipart.ts'

/**
 * A loader plugin to load source media.
 */
export type LoaderPlugin = {
  /** `name` gives the plugin a name. */
  name: string
  /** `type` specifies the plugin type. */
  type: 'loader'
  /** `test` matches the import url. */
  test: RegExp
  /** `acceptHMR` enables the HMR. */
  acceptHMR?: boolean
  /** `asPage` allows the loaded module as a page. */
  asPage?: boolean
  /** `resolve` resolves the module content. */
  resolve?(url: string): { content: Uint8Array } | Promise<{ content: Uint8Array }>
  /** `transform` transforms the source content. */
  transform(source: { url: string, content: Uint8Array, map?: Uint8Array }): LoaderTransformResult | Promise<LoaderTransformResult>
}

/**
 * The result of loader transform.
 */
export type LoaderTransformResult = {
  /** The transformed code in string. */
  code: string
  /** The transformed code type (default is 'js'). */
  type?: string
  /** The source map. */
  map?: string
}

/**
 * A server plugin to enhance the aleph server application.
 */
export type ServerPlugin = {
  /** `name` gives the plugin a name. */
  name: string
  /** `type` specifies the plugin type. */
  type: 'server'
  /** `onInit` will be invoked after the server initiated. */
  onInit(app: ServerApplication): Promise<void> | void
}

/**
 * A plugin for the aleph server application.
 */
export type Plugin = LoaderPlugin | ServerPlugin

/**
 * The config for the aleph server application.
 */
export type Config = {
  /** `framework` specifies the framework (default is 'react'). */
  framework?: 'react'
  /** `buildTarget` specifies the build target in production mode (default is **es5** to be compatible with IE11). */
  buildTarget?: 'es5' | 'es2015' | 'es2016' | 'es2017' | 'es2018' | 'es2019' | 'es2020'
  /** `baseUrl` specifies the path prefix for the application (default is '/'). */
  baseUrl?: string
  /** `srcDir` specifies the **src** dir (default is '/'). */
  srcDir?: string
  /** `outputDir` specifies the output directory for `build` command (default is '**dist**'). */
  outputDir?: string
  /** `defaultLocale` specifies the default locale of the application (default is '**en**'). */
  defaultLocale?: string
  /** `locales` specifies the available locales. */
  locales?: string[]
  /** `ssr` specifies the options for **SSR**. */
  ssr?: boolean | SSROptions
  /** `plugins` specifies some plugins for the appliaction. */
  plugins?: Plugin[]
  /** `headers` appends custom headers for server requests. */
  headers?: Record<string, string>
  /** `rewrites` specifies the server rewrite map. */
  rewrites?: Record<string, string>
  /** `env` appends system env variables. */
  env?: Record<string, string>
}

/**
 * The options for **SSR**.
 */
export type SSROptions = {
  /** A list of RegExp for paths to use **SSR**. */
  include?: RegExp[]
  /** A list of RegExp for paths to skip **SSR**. */
  exclude?: RegExp[]
  /** A list of paths for **dynamic routes** in **SSG**. */
  staticPaths?: string[]
}

/**
 * An interface that aligns to the parts of the aleph server's `Application`.
 */
export interface ServerApplication {
  readonly workingDir: string
  readonly mode: 'development' | 'production'
  readonly config: Required<Config>
  addModule(url: string, options?: { code?: string }): Promise<Module>
  injectCode(stage: 'compilation' | 'hmr' | 'ssr', transform: TransformFn): void
}

export type TransformFn = {
  (url: string, code: string): string
}

/** A module includes the compilation details. */
export type Module = {
  url: string
  deps: DependencyDescriptor[]
  sourceHash: string
  hash: string
  jsFile: string
}

/** The dependency descriptor. */
export type DependencyDescriptor = {
  url: string
  hash: string
  isDynamic?: boolean
}

/**
 * An interface that aligns to the parts of std http srever's `ServerRequest`.
 */
export interface ServerRequest {
  readonly url: string
  readonly method: string
  readonly headers: Headers
  readonly conn: Deno.Conn
  readonly r: BufReader
  readonly w: BufWriter
  readonly body: Deno.Reader
  respond(r: ServerResponse): Promise<void>
}

/**
 * An interface is compatible with std http srever's `request.respond()`.
 */
export interface ServerResponse {
  status?: number
  headers?: Headers
  body?: Uint8Array | Deno.Reader | string
}

/**
 * An interface extends the `ServerRequest` for API requests.
 */
export interface APIRequest extends ServerRequest {
  readonly params: Record<string, string>
  readonly query: URLSearchParams
  readonly cookies: ReadonlyMap<string, string>
  /** `readBody` reads the body to an object in bytes, string, json, or multipart form data. */
  readBody(type?: 'raw'): Promise<Uint8Array>
  readBody(type: 'text'): Promise<string>
  readBody(type: 'json'): Promise<any>
  readBody(type: 'form'): Promise<MultipartFormData>
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
  /** `send` replies to the request with any content with type. */
  send(data?: string | Uint8Array | ArrayBuffer, contentType?: string): Promise<void>
  /** `json` replies to the request with a json content. */
  json(data: any): Promise<void>
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
  readonly baseURL: string
  readonly locale: string
  readonly pathname: string
  readonly pagePath: string
  readonly params: Record<string, string>
  readonly query: URLSearchParams
  push(url: string): void
  replace(url: string): void
}
