import type { BufReader, BufWriter, MultipartFormData } from '../deps.ts'
import { brotli, gzipEncode, MultipartReader } from '../deps.ts'
import log from '../shared/log.ts'
import type { APIRequest, ServerRequest, ServerResponse } from '../types.ts'

export class Request implements APIRequest {
  #req: ServerRequest
  #params: Record<string, string>
  #query: URLSearchParams
  #cookies: ReadonlyMap<string, string>
  #resp = {
    status: 200,
    headers: new Headers({
      Server: 'Aleph.js',
    }),
    done: false
  }

  constructor(req: ServerRequest, params: Record<string, string>, query: URLSearchParams) {
    this.#req = req
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

  get headers(): Headers {
    return this.#req.headers
  }

  get conn(): Deno.Conn {
    return this.#req.conn
  }

  get r(): BufReader {
    return this.#req.r
  }

  get w(): BufWriter {
    return this.#req.w
  }

  get body(): Deno.Reader {
    return this.#req.body
  }

  async respond(r: ServerResponse): Promise<void> {
    return this.#req.respond(r)
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

  async readBody(type?: 'raw'): Promise<Uint8Array>
  async readBody(type: 'text'): Promise<string>
  async readBody(type: 'json'): Promise<any>
  async readBody(type: 'form'): Promise<MultipartFormData>
  async readBody(type?: string): Promise<any> {
    switch (type) {
      case 'text': {
        const buff: Uint8Array = await Deno.readAll(this.body)
        const encoded = new TextDecoder('utf-8').decode(buff)
        return encoded
      }
      case 'json': {
        const buff: Uint8Array = await Deno.readAll(this.body)
        const encoded = new TextDecoder('utf-8').decode(buff)
        const data = JSON.parse(encoded)
        return data
      }
      case 'form': {
        const contentType = this.headers.get('content-type') as string
        const reader = new MultipartReader(this.body, contentType)
        return reader.readForm()
      }
      default: {
        return await Deno.readAll(this.body)
      }
    }
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

  status(code: number): this {
    this.#resp.status = code
    return this
  }

  async send(data?: string | Uint8Array | ArrayBuffer, contentType?: string): Promise<void> {
    if (this.#resp.done) {
      log.warn('ServerRequest: repeat respond calls')
      return Promise.resolve()
    }

    let body = new Uint8Array()
    if (typeof data === 'string') {
      body = new TextEncoder().encode(data)
    } else if (data instanceof Uint8Array) {
      body = data
    } else if (data instanceof ArrayBuffer) {
      body = new Uint8Array(data)
    }
    if (contentType) {
      this.#resp.headers.set('Content-Type', contentType)
    } else if (this.#resp.headers.has('Content-Type')) {
      contentType = this.#resp.headers.get('Content-Type')!
    } else if (typeof data === 'string' && data.length > 0) {
      contentType = 'text/plain; charset=utf-8'
    }
    let shouldCompress = false
    if (contentType) {
      if (contentType.startsWith('text/')) {
        shouldCompress = true
      } else if (/^application\/(javascript|typecript|wasm|json|xml)/i.test(contentType)) {
        shouldCompress = true
      } else if (/^image\/svg+xml/i.test(contentType)) {
        shouldCompress = true
      }
    }
    if (shouldCompress && body.length > 1024) {
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
    try {
      await this.respond({
        status: this.#resp.status,
        headers: this.#resp.headers,
        body
      })
    } catch (err) {
      log.warn('ServerRequest.respond:', err.message)
    }
  }

  json(data: any, replacer?: (this: any, key: string, value: any) => any, space?: string | number): Promise<void> {
    return this.send(JSON.stringify(data, replacer, space), 'application/json; charset=utf-8')
  }
}
