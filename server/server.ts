import { path, serve as stdServe, ws } from '../deps.ts'
import { hashShort, reHashJs, reModuleExt } from '../shared/constants.ts'
import { existsFileSync } from '../shared/fs.ts'
import log from '../shared/log.ts'
import util from '../shared/util.ts'
import type { ServerRequest } from '../types.ts'
import { Request } from './api.ts'
import { Appliaction } from './app.ts'
import { getContentType } from './mime.ts'
import { createHtml } from './util.ts'

/** The Aleph Server class. */
export class Server {
    #app: Appliaction
    #ready: boolean

    constructor(app: Appliaction) {
        this.#app = app
        this.#ready = false
    }

    async handle(r: ServerRequest) {
        if (!this.#ready) {
            await this.#app.ready
            this.#ready = true
        }

        const app = this.#app
        const url = new URL('http://localhost' + r.url)
        const pathname = util.cleanPath(decodeURI(url.pathname))
        const req = new Request(r, pathname, {}, url.searchParams)

        try {
            // serve hmr ws
            if (pathname === '/_hmr') {
                const { conn, r: bufReader, w: bufWriter, headers } = r
                ws.acceptWebSocket({ conn, bufReader, bufWriter, headers }).then(async socket => {
                    const watcher = app.createFSWatcher()
                    watcher.on('add', (url: string, hash: string) => socket.send(JSON.stringify({
                        type: 'add',
                        url,
                        hash
                    })))
                    watcher.on('remove', (url: string) => {
                        watcher.removeAllListeners('modify-' + url)
                        socket.send(JSON.stringify({
                            type: 'remove',
                            url
                        }))
                    })
                    for await (const e of socket) {
                        if (util.isNEString(e)) {
                            try {
                                const data = JSON.parse(e)
                                if (data.type === 'hotAccept' && util.isNEString(data.url)) {
                                    const mod = app.getModule(data.url)
                                    if (mod) {
                                        watcher.on('modify-' + mod.url, (hash: string) => socket.send(JSON.stringify({
                                            type: 'update',
                                            url: mod.url,
                                            updateUrl: util.cleanPath(`${app.config.baseUrl}/_aleph/${mod.url.replace(reModuleExt, '')}.${hash!.slice(0, hashShort)}.js`),
                                            hash,
                                        })))
                                    }
                                }
                            } catch (e) { }
                        } else if (ws.isWebSocketCloseEvent(e)) {
                            break
                        }
                    }
                    app.removeFSWatcher(watcher)
                })
                return
            }

            // serve public files
            const filePath = path.join(app.workingDir, 'public', pathname)
            if (existsFileSync(filePath)) {
                const info = Deno.lstatSync(filePath)
                const lastModified = info.mtime?.toUTCString() ?? new Date().toUTCString()
                if (lastModified === r.headers.get('If-Modified-Since')) {
                    req.status(304).send('')
                    return
                }

                const body = Deno.readFileSync(filePath)
                req.setHeader('Last-Modified', lastModified)
                req.send(body, getContentType(filePath))
                return
            }

            // serve APIs
            if (pathname.startsWith('/api/')) {
                app.handleAPI(r, { pathname, search: url.search })
                return
            }

            // serve dist files
            if (pathname.startsWith('/_aleph/')) {
                if (pathname.startsWith('/_aleph/data/') && pathname.endsWith('.json')) {
                    let p = util.trimSuffix(util.trimPrefix(pathname, '/_aleph/data'), '.json')
                    if (p === '/index') {
                        p = '/'
                    }
                    const [status, data] = await app.getSSRData({ pathname: p })
                    if (status === 200) {
                        req.send(JSON.stringify(data), 'application/json; charset=utf-8')
                    } else {
                        req.status(status).send('')
                    }
                    return
                } else {
                    const reqMap = pathname.endsWith('.js.map')
                    const fixedPath = util.trimPrefix(reqMap ? pathname.slice(0, -4) : pathname, '/_aleph/')
                    const metaFile = path.join(app.buildDir, util.trimSuffix(fixedPath.replace(reHashJs, ''), '.js') + '.meta.json')
                    if (existsFileSync(metaFile)) {
                        const { url } = JSON.parse(await Deno.readTextFile(metaFile))
                        const mod = app.getModule(url)
                        if (mod) {
                            const etag = req.headers.get('If-None-Match')
                            if (etag && etag === mod.hash) {
                                req.status(304).send('')
                                return
                            }
                            let body = ''
                            if (reqMap) {
                                if (existsFileSync(mod.jsFile + '.map')) {
                                    body = await Deno.readTextFile(mod.jsFile + '.map')
                                } else {
                                    req.status(404).send('file not found')
                                    return
                                }
                            } else {
                                body = await Deno.readTextFile(mod.jsFile)
                                if (app.isHMRable(mod.url)) {
                                    body = app.injectHMRCode(mod, body)
                                }
                            }
                            req.setHeader('ETag', mod.hash)
                            req.send(body, `application/${reqMap ? 'json' : 'javascript'}; charset=utf-8`)
                            return
                        }
                    }
                }
                req.status(404).send('file not found')
                return
            }

            // ssr
            const [status, html] = await app.getPageHtml({ pathname, search: url.search })
            req.status(status).send(html, 'text/html; charset=utf-8')
        } catch (err) {
            req.status(500).send(createHtml({
                lang: 'en',
                head: ['<title>500 - internal server error</title>'],
                body: `<p><strong><code>500</code></strong><small> - </small><span>${err.message}</span></p>`
            }), 'text/html; charset=utf-8')
        }
    }
}

/** start a standard aleph server. */
export async function serve(hostname: string, port: number, app: Appliaction) {
    const server = new Server(app)
    while (true) {
        try {
            const s = stdServe({ hostname, port })
            log.info(`Aleph server ready on http://${hostname}:${port}`)
            for await (const r of s) {
                server.handle(r)
            }
        } catch (err) {
            if (err instanceof Deno.errors.AddrInUse) {
                log.warn(`port ${port} already in use, try ${port + 1}`)
                port++
            } else {
                log.fatal(err.message)
            }
        }
    }
}

/** parse port number */
export function parsePortNumber(v: string): number {
    const num = parseInt(v)
    if (isNaN(num) || num <= 0 || num > 1 << 16 || !Number.isInteger(num)) {
        log.error(`invalid port 'v'`)
        Deno.exit(1)
    }
    return num
}
