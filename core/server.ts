import { Request } from '../api.ts'
import { path, serve, ws } from '../deps.ts'
import util, { hashShort, reHashJs, reModuleExt } from '../util.ts'
import log from './log.ts'
import { getContentType } from './mime.ts'
import { Project } from './project.ts'
import { createHtml, existsFileSync, injectHmr } from './util.ts'

export async function start(appDir: string, port: number, isDev = false, reload = false) {
    const project = new Project(appDir, isDev ? 'development' : 'production', reload)
    await project.ready

    while (true) {
        try {
            const s = serve({ port })
            log.info(`Server ready on http://localhost:${port}`)
            for await (const req of s) {
                const url = new URL('http://localhost/' + req.url)
                const pathname = util.cleanPath(url.pathname)
                const resp = new Request(req, pathname, {}, url.searchParams)

                try {
                    // serve hmr ws
                    if (pathname === '/_hmr') {
                        const { conn, r: bufReader, w: bufWriter, headers } = req
                        ws.acceptWebSocket({ conn, bufReader, bufWriter, headers }).then(async socket => {
                            const watcher = project.createFSWatcher()
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
                                            const mod = project.getModule(data.url)
                                            if (mod) {
                                                watcher.on('modify-' + mod.url, (hash: string) => socket.send(JSON.stringify({
                                                    type: 'update',
                                                    url: mod.url,
                                                    updateUrl: util.cleanPath(`${project.config.baseUrl}/_aleph/${mod.url.replace(reModuleExt, '')}.${hash!.slice(0, hashShort)}.js`),
                                                    hash,
                                                })))
                                            }
                                        }
                                    } catch (e) { }
                                } else if (ws.isWebSocketCloseEvent(e)) {
                                    break
                                }
                            }
                            project.removeFSWatcher(watcher)
                        })
                        continue
                    }

                    // serve public files
                    const filePath = path.join(project.appRoot, 'public', decodeURI(pathname))
                    if (existsFileSync(filePath)) {
                        const info = Deno.lstatSync(filePath)
                        const lastModified = info.mtime?.toUTCString() ?? new Date().toUTCString()
                        if (lastModified === req.headers.get('If-Modified-Since')) {
                            resp.status(304).send('')
                            continue
                        }

                        const body = Deno.readFileSync(filePath)
                        resp.setHeader('Last-Modified', lastModified)
                        resp.send(body, getContentType(filePath))
                        continue
                    }

                    // serve APIs
                    if (pathname.startsWith('/api/')) {
                        project.callAPI(req, { pathname, search: url.search })
                        continue
                    }

                    // serve dist files
                    if (pathname.startsWith('/_aleph/')) {
                        if (pathname.startsWith('/_aleph/data/') && pathname.endsWith('.json')) {
                            let p = util.trimSuffix(util.trimPrefix(pathname, '/_aleph/data'), '.json')
                            if (p === '/index') {
                                p = '/'
                            }
                            const [status, data] = await project.getSSRData({ pathname: p })
                            if (status === 200) {
                                resp.send(JSON.stringify(data), 'application/json; charset=utf-8')
                            } else {
                                resp.status(status).send('')
                            }
                            continue
                        } else {
                            const reqMap = pathname.endsWith('.js.map')
                            const fixedPath = util.trimPrefix(reqMap ? pathname.slice(0, -4) : pathname, '/_aleph/')
                            const metaFile = path.join(project.buildDir, util.trimSuffix(fixedPath.replace(reHashJs, ''), '.js') + '.meta.json')
                            if (existsFileSync(metaFile)) {
                                const { url } = JSON.parse(await Deno.readTextFile(metaFile))
                                const mod = project.getModule(url)
                                if (mod) {
                                    const etag = req.headers.get('If-None-Match')
                                    if (etag && etag === mod.hash) {
                                        resp.status(304).send('')
                                        continue
                                    }
                                    let body = ''
                                    if (reqMap) {
                                        body = mod.jsSourceMap || ''
                                    } else {
                                        body = mod.jsContent
                                        if (project.isHMRable(mod.url)) {
                                            body = injectHmr({ ...mod, jsContent: body })
                                        }
                                    }
                                    resp.setHeader('ETag', mod.hash)
                                    resp.send(body, `application/${reqMap ? 'json' : 'javascript'}; charset=utf-8`)
                                    continue
                                }
                            }
                        }
                        resp.status(404).send('file not found')
                        continue
                    }

                    // ssr
                    const [status, html] = await project.getPageHtml({ pathname, search: url.search })
                    resp.status(status).send(html, 'text/html; charset=utf-8')
                } catch (err) {
                    resp.status(500).send(createHtml({
                        lang: 'en',
                        head: ['<title>500 - internal server error</title>'],
                        body: `<p><strong><code>500</code></strong><small> - </small><span>${err.message}</span></p>`
                    }), 'text/html; charset=utf-8')
                }
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
