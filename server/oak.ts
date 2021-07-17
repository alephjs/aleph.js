import type { Context } from 'https://deno.land/x/oak@v7.7.0/context.ts'
import type { Middleware } from 'https://deno.land/x/oak@v7.7.0/middleware.ts'
import { NativeRequest } from 'https://deno.land/x/oak@v7.7.0/http_server_native.ts'
import { Aleph } from './aleph.ts'
import { Server } from './server.ts'

/** `oakify` creates an **oak** middleware for Aleph app. */
export function oakify(aleph: Aleph): Middleware {
  const server = new Server(aleph)

  return (ctx: Context) => {
    const { originalRequest } = ctx.request
    if (originalRequest instanceof NativeRequest) {
      const { request, respond } = originalRequest
      server.handle({ request, respondWith: respond })
      ctx.respond = false
    } else {
      ctx.throw(500, 'Aleph.js doesn\'t support oak `ServerRequest` yet')
    }
  }
}
