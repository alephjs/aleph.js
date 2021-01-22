import { brotli, bufio, gzipEncode, Response, ServerRequest } from '../deps.ts'
import log from '../shared/log.ts'
import type { APIRequest, FormDataBody } from '../types.ts'
import { multiParser } from './multiparser.ts'

export class Request implements APIRequest {
    #req: ServerRequest
    #pathname: string
    #params: Record<string, string>
    #query: URLSearchParams
    #cookies: ReadonlyMap<string, string>
    #resp = {
        status: 200,
        headers: new Headers({
            'Status': '200',
            'Server': 'Aleph.js',
        }),
        done: false
    }

    constructor(req: ServerRequest, pathname: string, params: Record<string, string>, query: URLSearchParams) {
        this.#req = req
        this.#pathname = pathname
        this.#params = params
        this.#query = query
        const cookies = new Map()
        this.headers.get('cookie')?.split(';').forEach(cookie => {
            const p = cookie.trim().split('=')
            if (p.length >= 2) {
                cookies.set(p.shift()!.trim(), decodeURI(p.join('=')))
            }
        })
        this.#cookies = cookies
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

    get conn(): Deno.Conn {
        return this.#req.conn
    }

    get r(): bufio.BufReader {
        return this.#req.r
    }

    get w(): bufio.BufWriter {
        return this.#req.w
    }

    get done(): Promise<Error | undefined> {
        return this.#req.done
    }

    get contentLength(): number | null {
        return this.#req.contentLength
    }

    get body(): Deno.Reader {
        return this.#req.body
    }

    async respond(r: Response): Promise<void> {
        return this.#req.respond(r)
    }

    async finalize(): Promise<void> {
        return this.#req.finalize()
    }

    get pathname(): string {
        return this.#pathname
    }

    get params(): Record<string, string> {
        return this.#params
    }

    get query(): URLSearchParams {
        return this.#query
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

    async json(data: any, replacer?: (this: any, key: string, value: any) => any, space?: string | number): Promise<void> {
        await this.send(JSON.stringify(data, replacer, space), 'application/json; charset=utf-8')
    }

    async decodeBody(type: "text"): Promise<string>
    async decodeBody(type: "json"): Promise<any>
    async decodeBody(type: "form-data"): Promise<FormDataBody>
    async decodeBody(type: string): Promise<any> {
        if (type === "text") {
            const buff: Uint8Array = await Deno.readAll(this.body)
            const encoded = new TextDecoder("utf-8").decode(buff)
            return encoded
        }

        if (type === "json") {
            const buff: Uint8Array = await Deno.readAll(this.body)
            const encoded = new TextDecoder("utf-8").decode(buff)
            const json = JSON.parse(encoded)
            return json
        }

        if (type === "form-data") {
            const contentType = this.headers.get("content-type") as string
            const form = await multiParser(this.body, contentType)
            return form
        }
    }

    async send(data: string | Uint8Array | ArrayBuffer, contentType?: string): Promise<void> {
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
        } else if (typeof data === 'string' && data.length > 0) {
            contentType = 'text/plain; charset=utf-8'
        }
        let isText = false
        if (contentType) {
            if (contentType.startsWith('text/')) {
                isText = true
            } else if (/^application\/(javascript|typecript|json|xml)/i.test(contentType)) {
                isText = true
            } else if (/^image\/svg+xml/i.test(contentType)) {
                isText = true
            }
        }
        if (isText && body.length > 1024) {
            if (this.headers.get('accept-encoding')?.includes('br')) {
                this.#resp.headers.set('Vary', 'Origin')
                this.#resp.headers.set('Content-Encoding', 'br')
                body = brotli.compress(body)
            } else if (this.headers.get('accept-encoding')?.includes('gzip')) {
                this.#resp.headers.set('Vary', 'Origin')
                this.#resp.headers.set('Content-Encoding', 'gzip')
                body = gzipEncode(body)
            }
        }
        this.#resp.headers.set('Date', (new Date).toUTCString())
        this.#resp.done = true
        await this.respond({
            status: this.#resp.status,
            headers: this.#resp.headers,
            body
        }).catch((err: Error) => log.warn('ServerRequest.respond:', err.message))
    }
}
