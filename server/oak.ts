import type { Aleph } from './aleph.ts'
import { Server } from './server.ts'

/** `oakify` creates an **oak** middleware with Aleph server. */
export function oakify(aleph: Aleph) {
  const server = new Server(aleph)

  return (ctx: any) => {
    const { originalRequest } = ctx.request
    if ('respond' in originalRequest) {
      const { request, respond } = originalRequest
      server.handle({ request, respondWith: respond })
      ctx.respond = false
    } else {
      ctx.throw(500, 'Aleph.js doesn\'t support std `ServerRequest` yet')
    }
  }
}
