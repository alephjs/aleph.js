import { join } from 'https://deno.land/std@0.100.0/path/mod.ts'
import log from '../shared/log.ts'
import { getContentType } from './mime.ts'

/** proxy https://deno.land/x/aleph on localhost */
export async function localProxy(cwd: string, port: number) {
  const s = Deno.listen({ port })
  const serve = async (conn: Deno.Conn) => {
    const httpConn = Deno.serveHttp(conn)
    for await (const { request, respondWith } of httpConn) {
      await handle(request, respondWith)
    }
  }
  const handle = async (request: Request, respondWith: (r: Response | Promise<Response>) => Promise<void>) => {
    const url = new URL(request.url)
    const filepath = join(cwd, url.pathname)
    try {
      const info = await Deno.lstat(filepath)
      if (info.isDirectory) {
        const r = Deno.readDir(filepath)
        const items: string[] = []
        for await (const item of r) {
          if (!item.name.startsWith('.')) {
            items.push(`<li><a href='${join(url.pathname, encodeURI(item.name))}'>${item.name}${item.isDirectory ? '/' : ''}<a></li>`)
          }
        }
        respondWith(new Response(
          `<!DOCTYPE html><title>aleph.js${url.pathname}</title><h2>&nbsp;aleph.js${url.pathname}</h2><ul>${Array.from(items).join('')}</ul>`,
          {
            headers: new Headers({ 'Content-Type': 'text/html; charset=utf-8' })
          }
        ))
        return
      }
      respondWith(new Response(
        await Deno.readFile(filepath),
        {
          headers: new Headers({ 'Content-Type': getContentType(filepath) })
        }
      ))
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        respondWith(new Response('file not found', { status: 400 }))
        return
      }
      respondWith(new Response(err.message, { status: 500 }))
    }
  }

  // ALEPH_DEV_PORT env tells the server we are in dev mode
  // for Aleph.js development
  if (Deno.env.get('ALEPH_DEV_PORT') !== port.toString()) {
    Deno.env.set('ALEPH_DEV_PORT', port.toString())
  }

  log.debug(`Proxy https://deno.land/x/aleph on http://localhost:${port}`)

  for await (const conn of s) {
    serve(conn)
  }
}
