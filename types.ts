export interface AlephEnv {
    [key: string]: string
    readonly __version: string
    readonly __buildMode: string
    readonly __buildTarget: string
}

export interface SSROptions {
    fallback?: string // default is '_fallback.html'
    include?: RegExp[]
    exclude?: RegExp[]
    staticPaths?: string[]
}

/** Config for Aleph.js */
export interface Config {
    /** `srcDir` to put all your app `pages`, app.tsx, etc directories (default is '/') */
    srcDir?: string
    /** `outputDir` specifies the output directory for `build` command (default is 'dist') */
    outputDir?: string
    /** `baseUrl` specifies the path prefix for the application (default is '/') */
    baseUrl?: string
    /** `reactUrl` specifies the **react** url (default is 'https://esm.sh/react@16.14.0') */
    reactUrl?: string
    /** `reactDomUrl` specifies the **react-dom** url (default is 'https://esm.sh/react-dom@16.14.0') */
    reactDomUrl?: string
    /** `defaultLocale` specifies the default locale of the application (default is 'en') */
    defaultLocale?: string
    /** A list of locales */
    locales?: string[]
    /** Option for **SSR** */
    ssr?: boolean | SSROptions
    /** `buildTarget` specifies the build taget for **tsc** (possible values: `ES2015-ES2020, ESNext`, default is ES2015 for production and ES2018 for development) */
    buildTarget?: string
    /** Enable sourceMap in **production** mode (default is false) */
    sourceMap?: boolean
    /** `env` defines the `Window.ALEPH.ENV` object in the application */
    env?: Record<string, string>
}

export interface APIHandler {
    (req: APIRequest): void
}

export interface APIRequestURL {
    readonly pathname: string
    readonly params: Record<string, string>
    readonly query: URLSearchParams
}

export interface APIRequest {
    readonly method: string
    readonly proto: string
    readonly protoMinor: number
    readonly protoMajor: number
    readonly headers: Headers
    readonly conn: Deno.Conn
    readonly r: Deno.Reader
    readonly w: Deno.Writer
    readonly done: Promise<Error | undefined>
    readonly contentLength: number | null
    readonly body: Deno.Reader
    respond(r: Response): Promise<void>
    finalize(): Promise<void>
    // plus
    readonly url: APIRequestURL
    readonly cookies: ReadonlyMap<string, string>
    status(code: number): this
    addHeader(key: string, value: string): this
    setHeader(key: string, value: string): this
    removeHeader(key: string): this
    send(data: string | Uint8Array | ArrayBuffer): Promise<void>
    json(data: any): Promise<void>
    end(code: number): Promise<void>
}

export interface Response {
    status?: number
    headers?: Headers
    trailers?: () => Promise<Headers> | Headers
    body?: Uint8Array | Deno.Reader | string
}

export interface RouterURL {
    readonly locale: string
    readonly pathname: string
    readonly pagePath: string
    readonly params: Record<string, string>
    readonly query: URLSearchParams
}
