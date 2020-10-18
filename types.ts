export interface AlephRuntime {
    env: Record<string, string>
    __version: string
    __appRoot: string
    __buildMode: string
    __buildTarget: string
}

export interface SSROptions {
    readonly fallback?: string // default is '_fallback.html'
    readonly include?: RegExp[]
    readonly exclude?: RegExp[]
    readonly staticPaths?: string[]
}

export interface Config {
    readonly srcDir: string
    readonly outputDir: string
    readonly baseUrl: string
    readonly defaultLocale: string
    readonly locales: string[]
    readonly ssr: boolean | SSROptions
    readonly buildTarget: string
    readonly sourceMap: boolean
    readonly env: Record<string, string>
    readonly importMap: {
        imports: Record<string, string>
    }
}

export interface APIRequestURL {
    readonly pathname: string
    readonly params: Record<string, string>
    readonly query: URLSearchParams
}

export interface Response {
    status?: number
    headers?: Headers
    trailers?: () => Promise<Headers> | Headers
    body?: Uint8Array | Deno.Reader | string
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

export interface APIHandler {
    (req: APIRequest): void
}

export interface RouterURL {
    readonly locale: string
    readonly pathname: string
    readonly pagePath: string
    readonly params: Record<string, string>
    readonly query: URLSearchParams
}
