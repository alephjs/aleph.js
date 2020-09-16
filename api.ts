export interface AppManifest {
    readonly baseUrl: string
    readonly defaultLocale: string
    readonly locales: Record<string, Record<string, string>>
    readonly appModule: { hash: string } | null
    readonly pageModules: Record<string, { moduleId: string, hash: string }>
}

export interface RouterURL {
    locale: string
    asPath: string
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
