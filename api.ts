import { gzipEncode } from 'https://deno.land/x/wasm_gzip@v1.0.0/mod.ts'
import log from './log.ts'
import type { ServerRequest } from './std.ts'
import type { APIRequest, APIRequestURL, APIResponse, RouterURL } from './types.ts'

export class AlephAPIRequest implements APIRequest {
    #req: ServerRequest
    #url: APIRequestURL
    #cookies: ReadonlyMap<string, string>

    constructor(req: ServerRequest, url: RouterURL) {
        const paramsMap = new Map<string, string>()
        for (const key in url.params) {
            paramsMap.set(key, url.params[key])
        }
        this.#req = req
        this.#url = {
            proto: this.#req.proto,
            protoMinor: this.#req.protoMinor,
            protoMajor: this.#req.protoMajor,
            pathname: url.pathname,
            params: paramsMap,
            query: url.query,
        }
        this.#cookies = new Map() // todo: parse cookies
    }

    get method(): string {
        return this.#req.method
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
}

export class AlephAPIResponse implements APIResponse {
    #req: ServerRequest
    #status: number
    #headers: Headers
    #sent: boolean

    constructor(req: ServerRequest) {
        this.#req = req
        this.#status = 200
        this.#headers = new Headers({
            'Status': '200',
            'Server': 'Aleph.js',
        })
        this.#sent = false
    }

    status(code: number): this {
        this.#headers.set('status', code.toString())
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

    async json(data: any, replacer?: (this: any, key: string, value: any) => any, space?: string | number) {
        return this.send(JSON.stringify(data, replacer, space), 'application/json')
    }

    async send(data: string | Uint8Array | ArrayBuffer, contentType?: string) {
        if (this.#sent) {
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
            this.#headers.set('Content-Type', contentType)
        } else if (this.#headers.has('Content-Type')) {
            contentType = this.#headers.get('Content-Type')!
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
            this.#headers.set('Vary', 'Origin')
            this.#headers.set('Content-Encoding', 'gzip')
            body = gzipEncode(body)
        }
        this.#headers.set('Date', (new Date).toUTCString())
        this.#sent = true
        return this.#req.respond({
            status: this.#status,
            headers: this.#headers,
            body
        }).catch(err => log.warn('ServerRequest.respond:', err.message))
    }

    async end(status: number) {
        if (this.#sent) {
            log.warn('ServerRequest: repeat respond calls')
            return
        }
        this.#headers.set('Date', (new Date).toUTCString())
        this.#sent = true
        return this.#req.respond({
            status,
            headers: this.#headers,
        }).catch(err => log.warn('ServerRequest.respond:', err.message))
    }
}
