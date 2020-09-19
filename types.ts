export interface Config {
    readonly srcDir: string
    readonly outputDir: string
    readonly baseUrl: string
    readonly defaultLocale: string
    readonly ssr: boolean | { include?: string[], exclude?: string[] }
    readonly buildTarget: string
    readonly sourceMap: boolean
    readonly importMap: {
        imports: Record<string, string>
    }
}

export interface AppManifest {
    readonly baseUrl: string
    readonly defaultLocale: string
    readonly locales: Record<string, Record<string, string>>
}

export interface RouterURL {
    locale: string
    pathname: string
    pagePath: string
    params: Record<string, string>
    query: Record<string, string | string[]>
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
    readonly query: Record<string, string | string[]>
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
