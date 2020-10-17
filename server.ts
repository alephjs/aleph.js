import { AlephAPIResponse } from './api.ts'
import { createHtml } from './html.ts'
import log from './log.ts'
import { getContentType } from './mime.ts'
import { injectHmr, Project } from './project.ts'
import { path, serve, ws } from './std.ts'
import util, { existsFileSync, hashShort } from './util.ts'

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
                const resp = new AlephAPIResponse(req)

                try {
                    // serve hmr ws
                    if (pathname === '/_hmr') {
                        const { conn, r: bufReader, w: bufWriter, headers } = req
                        ws.acceptWebSocket({ conn, bufReader, bufWriter, headers }).then(async socket => {
                            const watcher = project.createFSWatcher()
                            watcher.on('add', (moduleId: string, hash: string) => socket.send(JSON.stringify({
                                type: 'add',
                                moduleId,
                                hash
                            })))
                            watcher.on('remove', (moduleId: string) => {
                                watcher.removeAllListeners('modify-' + moduleId)
                                socket.send(JSON.stringify({
                                    type: 'remove',
                                    moduleId
                                }))
                            })
                            for await (const e of socket) {
                                if (util.isNEString(e)) {
                                    try {
                                        const data = JSON.parse(e)
                                        if (data.type === 'hotAccept' && util.isNEString(data.id)) {
                                            const mod = project.getModule(data.id)
                                            if (mod) {
                                                watcher.on('modify-' + mod.id, (hash: string) => socket.send(JSON.stringify({
                                                    type: 'update',
                                                    moduleId: mod.id,
                                                    hash,
                                                    updateUrl: path.join('/', project.config.baseUrl, '/_aleph/', mod.id.replace(/\.js$/, '') + `.${hash!.slice(0, hashShort)}.js`)
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

                    // serve APIs
                    if (pathname.startsWith('/api/')) {
                        project.callAPI(req, { pathname, search: url.search })
                        continue
                    }

                    // serve dist files
                    if (pathname.startsWith('/_aleph/')) {
                        if (pathname.endsWith('.css')) {
                            const filePath = path.join(project.buildDir, util.trimPrefix(pathname, '/_aleph/'))
                            if (existsFileSync(filePath)) {
                                const body = await Deno.readFile(filePath)
                                resp.send(body, 'text/css; charset=utf-8')
                                continue
                            }
                        } else {
                            const reqSourceMap = pathname.endsWith('.js.map')
                            const mod = project.getModuleByPath(reqSourceMap ? pathname.slice(0, -4) : pathname)
                            if (mod) {
                                const etag = req.headers.get('If-None-Match')
                                if (etag && etag === mod.hash) {
                                    resp.end(304)
                                    continue
                                }

                                let body = ''
                                if (mod.id === '/data.js') {
                                    const data = await project.getStaticData()
                                    if (project.isDev) {
                                        body = [
                                            `import { createHotContext } from "./-/deno.land/x/aleph/hmr.js";`,
                                            `import events from "./-/deno.land/x/aleph/events.js";`,
                                            `import.meta.hot = createHotContext("/data.js");`,
                                            `export default ${JSON.stringify(data, undefined, 4)};`,
                                            `import.meta.hot.accept(({ default: data }) => events.emit("update-data", data));`
                                        ].join('\n')
                                    } else {
                                        body = `export default ${JSON.stringify(data)}`
                                    }
                                } else if (reqSourceMap) {
                                    body = mod.jsSourceMap
                                } else {
                                    body = mod.jsContent
                                    if (project.isHMRable(mod.id)) {
                                        body = injectHmr({ ...mod, jsContent: body })
                                    }
                                }
                                resp.setHeader('ETag', mod.hash)
                                resp.send(body, `application/${reqSourceMap ? 'json' : 'javascript'}; charset=utf-8`)
                                continue
                            }
                        }
                    }

                    // serve public files
                    const filePath = path.join(project.appRoot, 'public', pathname)
                    if (existsFileSync(filePath)) {
                        const info = await Deno.lstat(filePath)
                        if (info.mtime?.toUTCString() === req.headers.get('If-Modified-Since')) {
                            resp.end(304)
                            continue
                        }

                        const body = await Deno.readFile(filePath)
                        resp.setHeader('Last-Modified', info.mtime!.toUTCString())
                        resp.send(body, getContentType(filePath))
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


