import { APIResponse as IResponse } from '../types.d.ts'
import log from '../shared/log.ts'
import compress from './compress.ts'

export class APIResponse implements IResponse {
  status = 200
  headers = new Headers()
  body?: string | Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>

  addHeader(key: string, value: string): this {
    this.headers.append(key, value)
    return this
  }

  setHeader(key: string, value: string): this {
    this.headers.set(key, value)
    return this
  }

  removeHeader(key: string): this {
    this.headers.delete(key)
    return this
  }

  redirect(url: string, status = 302): this {
    this.setHeader('Location', url)
    this.status = status
    return this
  }

  json(data: any, space?: string | number): this {
    this.setHeader('Content-Type', 'application/json; charset=utf-8')
    this.body = JSON.stringify(data, undefined, space)
    return this
  }

  async writeTo({ request, respondWith }: Deno.RequestEvent, status?: number): Promise<void> {
    let { body, headers, } = this
    let contentType: string | null = null
    if (headers.has('Content-Type')) {
      contentType = headers.get('Content-Type')!
    } else if (typeof body === 'string') {
      contentType = 'text/plain; charset=utf-8'
      headers.set('Content-Type', contentType)
    }
    if (!headers.has('Date')) {
      headers.set('Date', (new Date).toUTCString())
    }

    const acceptEncoding = request.headers.get('accept-encoding')
    if (acceptEncoding && body && contentType) {
      let data = new Uint8Array()
      if (typeof body === 'string') {
        data = new TextEncoder().encode(body)
      } else if (body instanceof Uint8Array) {
        data = body
      } else if (body instanceof ArrayBuffer) {
        data = new Uint8Array(body)
      }
      const contentEncoding = compress.accept(acceptEncoding, contentType, data.length)
      if (contentEncoding) {
        body = await compress.compress(data, contentEncoding)
        headers.set('Vary', 'Origin')
        headers.set('Content-Encoding', contentEncoding)
      }
    }

    try {
      await respondWith(new Response(body, { headers, status: status || this.status }))
    } catch (err) {
      log.warn('http:', err.message)
    }
  }
}
