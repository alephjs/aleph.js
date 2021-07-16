import { APIResponse } from '../types.ts'
import log from '../shared/log.ts'
import compress from './compress.ts'

export class AResponse implements APIResponse {
  #req: Request
  #status = 200
  #headers = new Headers()
  #sent = false
  #respond: (r: Response | Promise<Response>) => Promise<void>

  constructor(req: Request, respond: (r: Response | Promise<Response>) => Promise<void>) {
    this.#req = req
    this.#respond = respond
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

  async send(data?: string | Uint8Array | ArrayBuffer, contentType?: string): Promise<void> {
    if (this.#sent) {
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
    const headers = this.#headers
    if (contentType) {
      headers.set('Content-Type', contentType)
    } else if (headers.has('Content-Type')) {
      contentType = headers.get('Content-Type')!
    } else if (typeof data === 'string' && data.length > 0) {
      contentType = 'text/plain; charset=utf-8'
      headers.set('Content-Type', contentType)
    }
    if (contentType) {
      body = compress.compress(body, {
        contentType,
        reqHeaders: this.#req.headers,
        respHeaders: this.#headers,
      })
    }
    if (!headers.has('Date')) {
      headers.set('Date', (new Date).toUTCString())
    }
    this.#sent = true

    try {
      await this.#respond(new Response(body, { headers, status: this.#status }))
    } catch (err) {
      log.warn('send:', err.message)
    }
  }

  json(data: any, replacer?: (this: any, key: string, value: any) => any, space?: string | number): Promise<void> {
    return this.send(JSON.stringify(data, replacer, space), 'application/json; charset=utf-8')
  }
}
