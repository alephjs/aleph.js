import type { BufReader, BufWriter } from 'std/io/bufio.ts'
import type { MultipartFormData } from 'std/mime/multipart.ts'
import { Plugin, PluginCreator } from 'https://esm.sh/postcss@8.2.8'

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
  /** allowPage` allows the loaded module as a page. */
  allowPage?: boolean
  /** `pagePathReoslve` resolves the page path. */
  pagePathResolve?(url: string): { path: string, isIndex?: boolean }
  /** `resolve` resolves the module content. */
  resolve?(url: string): Uint8Array | Promise<Uint8Array>
  /** `transform` transforms the source content. */
  transform?(input: { url: string, content: Uint8Array, map?: Uint8Array }): LoaderTransformOutput | Promise<LoaderTransformOutput>
}

/**
 * The result of loader transform.
 */
export type LoaderTransformOutput = {
  /** The transformed code type (default is 'js'). */
  type?: 'css' | 'js' | 'jsx' | 'ts' | 'tsx'
  /** The transformed code. */
  code: string
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

export type PostCSSPlugin = string | [string, any] | Plugin | PluginCreator<any>

/**
 * The config for the aleph server application.
 */
export type Config = {
  /** `framework` specifies the framework (default is 'react'). */
  framework?: 'react'
  /** `buildTarget` specifies the build target in production mode (default is **es2015**). */
  buildTarget?: 'es2015' | 'es2016' | 'es2017' | 'es2018' | 'es2019' | 'es2020'
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
  plugins?: (LoaderPlugin | ServerPlugin)[]
  /** `postcss` specifies the postcss plugins. */
  postcss?: { plugins: PostCSSPlugin[] }
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
}

/**
 * An interface that aligns to the parts of the aleph server's `Application`.
 */
export interface ServerApplication {
  readonly workingDir: string
  readonly mode: 'development' | 'production'
  readonly config: Required<Config>
  addModule(url: string, options?: { code?: string }): Promise<void>
  injectCode(
    stage: 'compilation' | 'hmr' | 'ssr',
    transform: (url: string, code: string) => string
  ): void
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
  readonly params: URLSearchParams
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
  readonly params: URLSearchParams
  push(url: string): void
  replace(url: string): void
}
