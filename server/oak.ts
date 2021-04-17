import type { Context } from 'https://deno.land/x/oak@v7.2.0/context.ts'
import type { Middleware } from 'https://deno.land/x/oak@v7.2.0/middleware.ts'
import { Application } from './app.ts'
import { Server } from './server.ts'

/** Create an oak middleware for Aleph server. */
export function alephOak(app: Application): Middleware {
  const server = new Server(app)

  return (ctx: Context) => {
    server.handle(ctx.request.originalRequest)
    ctx.respond = false
  }
}
