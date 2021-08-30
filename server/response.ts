import { APIResponse as IResponse } from '../types.d.ts'

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
}
