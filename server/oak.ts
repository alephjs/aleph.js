import type { Context } from 'https://deno.land/x/oak@v7.3.0/context.ts'
import type { Middleware } from 'https://deno.land/x/oak@v7.3.0/middleware.ts'
import { NativeRequest } from 'https://deno.land/x/oak@v7.3.0/http_server_native.ts'
import { Application } from './app.ts'
import { Server } from './server.ts'

/** Create an oak middleware for Aleph server. */
export function alephOak(app: Application): Middleware {
  const server = new Server(app)

  return (ctx: Context) => {
    const { originalRequest } = ctx.request
    if (originalRequest instanceof NativeRequest) {
      ctx.throw(500, 'Aleph.js doesn\'t support NativeRequest yet')
    } else {
      server.handle(originalRequest)
      ctx.respond = false
    }
  }
}
