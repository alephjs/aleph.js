import { APIResponse as IResponse } from '../types.ts'
import log from '../shared/log.ts'
import compress from './compress.ts'

export class APIResponse implements IResponse {
  #req: Request
  #status = 200
  #headers = new Headers()
  #sent = false
  #respond: (r: Response | Promise<Response>) => Promise<void>

  constructor(e: Deno.RequestEvent) {
    this.#req = e.request
    this.#respond = e.respondWith
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

  status(status: number): this {
    this.#status = status
    return this
  }

  redirect(url: string, status = 302): Promise<void> {
    return this.#respond(Response.redirect(url, status))
  }

  async send(data?: string | Uint8Array | ArrayBuffer | null, contentType?: string): Promise<void> {
    if (this.#sent) {
      log.warn('ServerRequest: repeat respond calls')
      return Promise.resolve()
    }

    const headers = this.#headers
    if (contentType) {
      headers.set('Content-Type', contentType)
    } else if (headers.has('Content-Type')) {
      contentType = headers.get('Content-Type')!
    } else if (typeof data === 'string') {
      contentType = 'text/plain; charset=utf-8'
      headers.set('Content-Type', contentType)
    }
    if (!headers.has('Date')) {
      headers.set('Date', (new Date).toUTCString())
    }

    const acceptEncoding = this.#req.headers.get('accept-encoding')
    if (acceptEncoding && data && contentType) {
      let body = new Uint8Array()
      if (typeof data === 'string') {
        body = new TextEncoder().encode(data)
      } else if (data instanceof Uint8Array) {
        body = data
      } else if (data instanceof ArrayBuffer) {
        body = new Uint8Array(data)
      }
      const contentEncoding = compress.accept(acceptEncoding, contentType, body.length)
      if (contentEncoding) {
        data = await compress.compress(body, contentEncoding)
        headers.set('Vary', 'Origin')
        headers.set('Content-Encoding', contentEncoding)
      }
    }

    try {
      await this.#respond(new Response(data, { headers, status: this.#status }))
    } catch (err) {
      log.warn('send:', err.message)
    } finally {
      this.#sent = true
    }
  }

  json(data: any, replacer?: (this: any, key: string, value: any) => any, space?: string | number): Promise<void> {
    return this.send(JSON.stringify(data, replacer, space), 'application/json; charset=utf-8')
  }
}
