import { path, serve } from '../deps.ts'
import log from '../shared/log.ts'
import util from '../shared/util.ts'
import { Request } from './api.ts'
import { getContentType } from './mime.ts'
import { createHtml } from './util.ts'

/** proxy https://deno.land/x/aleph on localhost */
export async function localProxy() {
    const p = Deno.env.get('ALEPH_DEV_PORT')
    if (!p) {
        return
    }

    if (!/^\d+$/.test(p)) {
        log.fatal('invalid ALEPH_DEV_PORT:', p)
    }

    const cwd = Deno.cwd()
    const port = parseInt(p)
    const s = serve({ port })

    log.info(`Proxy https://deno.land/x/aleph on http://localhost:${port}`)
    for await (const r of s) {
        const url = new URL('http://localhost' + r.url)
        const resp = new Request(r, util.cleanPath(url.pathname), {}, url.searchParams)
        const filepath = path.join(cwd, url.pathname)
        try {
            const info = await Deno.lstat(filepath)
            if (info.isDirectory) {
                const r = Deno.readDir(filepath)
                const items: string[] = []
                for await (const item of r) {
                    if (!item.name.startsWith('.')) {
                        items.push(`<li><a href='${path.join(url.pathname, encodeURI(item.name))}'>${item.name}${item.isDirectory ? '/' : ''}<a></li>`)
                    }
                }
                resp.send(createHtml({
                    head: [`<title>aleph.js/</title>`],
                    body: `<h1>&nbsp;aleph.js/</h1><ul>${Array.from(items).join('')}</ul>`
                }), 'text/html')
                return
            }
            resp.send(await Deno.readFile(filepath), getContentType(filepath))
        } catch (err) {
            if (err instanceof Deno.errors.NotFound) {
                resp.status(404).send('file not found')
                return
            }
            resp.status(500).send(err.message)
        }
    }
}
