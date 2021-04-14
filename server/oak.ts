import type { Middleware, Context } from 'https://deno.land/x/oak/mod.ts'
import { Application } from './app.ts'
import { Server } from './server.ts'

/** Create an oak middleware for Aleph server. */
export function alephOak(app: Application): Middleware {
  const server = new Server(app)

  return (ctx: Context) => {
    const req = ctx.request as any
    server.handle(req.originalRequest || req.serverRequest)
    ctx.respond = false
  }
}
