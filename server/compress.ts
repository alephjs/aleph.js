import type { ServerRequest, ServerResponse } from '../types.ts'

const brotliMod = 'https://deno.land/x/brotli@v0.1.4/mod.ts'
const flateMod = 'https://deno.land/x/denoflate@1.1/mod.ts'

class Compression {
  #brotli: ((data: Uint8Array) => Uint8Array) | null = null
  #gzip: ((data: Uint8Array) => Uint8Array) | null = null
  #ready: boolean = false

  async init() {
    if (this.#brotli === null) {
      const { compress } = await import(brotliMod)
      this.#brotli = compress
    }
    if (this.#gzip === null) {
      const denoflate = await import(flateMod)
      this.#gzip = (data: Uint8Array) => denoflate.gzip(data, undefined)
    }
    this.#ready = true
  }

  apply(req: ServerRequest, resp: ServerResponse, contentType: string, content: Uint8Array): Uint8Array {
    if (!this.#ready) {
      return content
    }

    let shouldCompress = false
    if (contentType) {
      if (contentType.startsWith('text/')) {
        shouldCompress = true
      } else if (/^application\/(javascript|json|xml|wasm)/i.test(contentType)) {
        shouldCompress = true
      } else if (/^image\/svg\+xml/i.test(contentType)) {
        shouldCompress = true
      }
    }

    if (shouldCompress && content.length > 1024) {
      const ae = req.headers.get('accept-encoding') || ''
      if (ae.includes('br') && this.#brotli !== null) {
        resp.headers?.set('Vary', 'Origin')
        resp.headers?.set('Content-Encoding', 'br')
        return this.#brotli(content)
      } else if (ae.includes('gzip') && this.#gzip !== null) {
        resp.headers?.set('Vary', 'Origin')
        resp.headers?.set('Content-Encoding', 'gzip')
        return this.#gzip(content)
      }
    }

    return content
  }
}

export default new Compression()
