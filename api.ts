import { gzipEncode } from 'https://deno.land/x/wasm_gzip@v1.0.0/mod.ts'
import log from './log.ts'
import type { ServerRequest } from './std.ts'
import type { APIRequest, APIRequestURL, Response } from './types.ts'

export class Request implements APIRequest {
    #req: ServerRequest
    #url: APIRequestURL
    #cookies: ReadonlyMap<string, string> = new Map()
    #resp = {
        status: 200,
        headers: new Headers({
            'Status': '200',
            'Server': 'Aleph.js',
        }),
        done: false
    }

    constructor(req: ServerRequest, url: APIRequestURL) {
        this.#req = req
        this.#url = url
    }

    get method(): string {
        return this.#req.method
    }

    get proto() {
        return this.#req.proto
    }

    get protoMinor() {
        return this.#req.protoMinor
    }

    get protoMajor() {
        return this.#req.protoMajor
    }

    get conn() {
        return this.#req.conn
    }

    get r() {
        return this.#req.r
    }

    get w() {
        return this.#req.w
    }

    get done() {
        return this.#req.done
    }

    get contentLength() {
        return this.#req.contentLength
    }

    get body() {
        return this.#req.body
    }

    async respond(r: Response) {
        return this.#req.respond(r)
    }

    async finalize() {
        return this.#req.finalize()
    }

    get url(): APIRequestURL {
        return this.#url
    }

    get headers(): Headers {
        return this.#req.headers
    }

    get cookies(): ReadonlyMap<string, string> {
        return this.#cookies
    }

    status(code: number): this {
        this.#resp.headers.set('status', code.toString())
        this.#resp.status = code
        return this
    }

    addHeader(key: string, value: string): this {
        this.#resp.headers.append(key, value)
        return this
    }

    setHeader(key: string, value: string): this {
        this.#resp.headers.set(key, value)
        return this
    }

    removeHeader(key: string): this {
        this.#resp.headers.delete(key)
        return this
    }

    json(data: any, replacer?: (this: any, key: string, value: any) => any, space?: string | number) {
        return this.send(JSON.stringify(data, replacer, space), 'application/json')
    }

    async send(data: string | Uint8Array | ArrayBuffer, contentType?: string) {
        if (this.#resp.done) {
            log.warn('ServerRequest: repeat respond calls')
            return
        }
        let body: Uint8Array
        if (typeof data === 'string') {
            body = new TextEncoder().encode(data)
        } else if (data instanceof ArrayBuffer) {
            body = new Uint8Array(data)
        } else if (data instanceof Uint8Array) {
            body = data
        } else {
            return
        }
        if (contentType) {
            this.#resp.headers.set('Content-Type', contentType)
        } else if (this.#resp.headers.has('Content-Type')) {
            contentType = this.#resp.headers.get('Content-Type')!
        }
        let isText = false
        if (contentType) {
            if (contentType.startsWith('text/')) {
                isText = true
            } else if (/^application\/(javascript|typecript|json|xml)/.test(contentType)) {
                isText = true
            } else if (/^image\/svg+xml/.test(contentType)) {
                isText = true
            }
        }
        if (isText && body.length > 1024 && this.#req.headers.get('accept-encoding')?.includes('gzip')) {
            this.#resp.headers.set('Vary', 'Origin')
            this.#resp.headers.set('Content-Encoding', 'gzip')
            body = gzipEncode(body)
        }
        this.#resp.headers.set('Date', (new Date).toUTCString())
        this.#resp.done = true
        return this.#req.respond({
            status: this.#resp.status,
            headers: this.#resp.headers,
            body
        }).catch(err => log.warn('ServerRequest.respond:', err.message))
    }

    async end(status: number) {
        if (this.#resp.done) {
            log.warn('ServerRequest: repeat respond calls')
            return
        }
        this.#resp.headers.set('Date', (new Date).toUTCString())
        this.#resp.done = true
        return this.#req.respond({
            status,
            headers: this.#resp.headers,
        }).catch(err => log.warn('ServerRequest.respond:', err.message))
    }
}
