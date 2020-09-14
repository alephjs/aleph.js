import type { APIRequest, APIResponse } from '../api.ts'
import type { ServerRequest } from '../deps.ts'

export class PostAPIRequest implements APIRequest {
    private _req: ServerRequest

    cookies: ReadonlyMap<string, string>
    params: ReadonlyMap<string, string>
    query: Record<string, string | string[]>

    constructor(req: ServerRequest, params: Record<string, string>, query: Record<string, string | string[]>) {
        this._req = req

        const paramsMap = new Map<string, string>()
        for (const key in params) {
            paramsMap.set(key, params[key])
        }
        this.params = paramsMap

        // todo: parse cookies
        this.cookies = new Map()

        this.query = query
    }

    get url(): string {
        return this._req.url
    }

    get method(): string {
        return this._req.method
    }

    get proto(): string {
        return this._req.proto
    }

    get protoMinor(): number {
        return this._req.protoMinor
    }

    get protoMajor(): number {
        return this._req.protoMajor
    }

    get headers(): Headers {
        return this._req.headers
    }
}

export class PostAPIResponse implements APIResponse {
    private _req: ServerRequest
    private _headers: Headers
    private _status: number

    constructor(req: ServerRequest) {
        this._req = req
        this._headers = new Headers()
        this._status = 200
    }

    status(code: number): this {
        this._status = code
        return this
    }

    addHeader(key: string, value: string): this {
        this._headers.append(key, value)
        return this
    }

    setHeader(key: string, value: string): this {
        this._headers.set(key, value)
        return this
    }

    removeHeader(key: string): this {
        this._headers.delete(key)
        return this
    }

    send(data: string | Uint8Array | ArrayBuffer) {
        let body: string | Uint8Array
        if (data instanceof ArrayBuffer) {
            body = new Uint8Array(data)
        } else {
            body = data
        }
        return this._req.respond({
            status: this._status,
            headers: this._headers,
            body
        })
    }

    json(data: any) {
        this._headers.set('Content-Type', 'application/json')
        return this._req.respond({
            status: this._status,
            headers: this._headers,
            body: JSON.stringify(data)
        })
    }
}
