export interface Config {
    readonly srcDir: string
    readonly outputDir: string
    readonly baseUrl: string
    readonly defaultLocale: string
    readonly ssr: boolean | SSROptions
    readonly buildTarget: string
    readonly sourceMap: boolean
    readonly importMap: {
        imports: Record<string, string>
    }
}

export interface SSROptions {
    readonly fallback: string, // default is 404.html
    readonly include?: string[],
    readonly exclude?: string[]
}

export interface AppManifest {
    readonly baseUrl: string
    readonly defaultLocale: string
    readonly locales: Record<string, Record<string, string>>
}

export interface RouterURL {
    readonly locale: string
    readonly pathname: string
    readonly pagePath: string
    readonly params: Record<string, string>
    readonly query: URLSearchParams
}

export interface Location {
    pathname: string
    search?: string
}

export interface APIRequest {
    readonly url: string
    readonly method: string
    readonly proto: string
    readonly protoMinor: number
    readonly protoMajor: number
    readonly headers: Headers
    readonly cookies: ReadonlyMap<string, string>
    readonly params: ReadonlyMap<string, string>
    readonly query: URLSearchParams
}

export interface APIResponse {
    status(code: number): this
    addHeader(key: string, value: string): this
    setHeader(key: string, value: string): this
    removeHeader(key: string): this
    send(data: string | Uint8Array | ArrayBuffer): Promise<void>
    json(data: any): Promise<void>
}

export interface APIHandle {
    (req: APIRequest, res: APIResponse): void
}

export interface Module {
    readonly id: string,
    readonly hash: string,
}
