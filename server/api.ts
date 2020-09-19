import type { APIRequest, APIResponse } from '../types.ts'
import type { ServerRequest } from '../deps.ts'

export class PostAPIRequest implements APIRequest {
    #req: ServerRequest

    cookies: ReadonlyMap<string, string>
    params: ReadonlyMap<string, string>
    query: Record<string, string | string[]>

    constructor(req: ServerRequest, params: Record<string, string>, query: Record<string, string | string[]>) {
        this.#req = req

        const paramsMap = new Map<string, string>()
        for (const key in params) {
            paramsMap.set(key, params[key])
        }
        this.params = paramsMap

        this.cookies = new Map()
        // todo: parse cookies

        this.query = query
    }

    get url(): string {
        return this.#req.url
    }

    get method(): string {
        return this.#req.method
    }

    get proto(): string {
        return this.#req.proto
    }

    get protoMinor(): number {
        return this.#req.protoMinor
    }

    get protoMajor(): number {
        return this.#req.protoMajor
    }

    get headers(): Headers {
        return this.#req.headers
    }
}

export class PostAPIResponse implements APIResponse {
    #req: ServerRequest
    #headers: Headers
    #status: number

    constructor(req: ServerRequest) {
        this.#req = req
        this.#headers = new Headers()
        this.#status = 200
    }

    status(code: number): this {
        this.#status = code
        return this
    }

    addHeader(key: string, value: string): this {
        this.#headers.append(key, value)
        return this
    }

    setHeader(key: string, value: string): this {
        this.#headers.set(key, value)
        return this
    }

    removeHeader(key: string): this {
        this.#headers.delete(key)
        return this
    }

    send(data: string | Uint8Array | ArrayBuffer) {
        let body: string | Uint8Array
        if (data instanceof ArrayBuffer) {
            body = new Uint8Array(data)
        } else {
            body = data
        }
        return this.#req.respond({
            status: this.#status,
            headers: this.#headers,
            body
        })
    }

    json(data: any) {
        this.#headers.set('Content-Type', 'application/json')
        return this.#req.respond({
            status: this.#status,
            headers: this.#headers,
            body: JSON.stringify(data)
        })
    }
}
