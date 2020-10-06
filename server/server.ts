import { createHtml } from '../html.ts'
import log from '../log.ts'
import Project, { injectHmr } from '../project.ts'
import { createRouter } from '../router.ts'
import { path, serve, ws } from '../std.ts'
import util, { hashShort } from '../util.ts'
import { PostAPIRequest, PostAPIResponse } from './api.ts'
import { getContentType } from './mime.ts'

export async function start(appDir: string, port: number, isDev = false) {
    const project = new Project(appDir, isDev ? 'development' : 'production')
    await project.ready

    while (true) {
        try {
            const s = serve({ port })
            log.info(`Server ready on http://localhost:${port}`)
            for await (const req of s) {
                const url = new URL('http://localhost/' + req.url)
                const pathname = util.cleanPath(url.pathname)

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

                    // serve apis
                    if (pathname.startsWith('/api/')) {
                        const { pagePath, params, query } = createRouter(
                            project.config.baseUrl,
                            project.apiPaths,
                            { location: { pathname, search: url.search } }
                        )
                        const handle = await project.getAPIHandle(pagePath)
                        if (handle) {
                            handle(
                                new PostAPIRequest(req, params, query),
                                new PostAPIResponse(req)
                            )
                        } else {
                            req.respond({
                                status: 404,
                                headers: new Headers({ 'Content-Type': 'application/javascript; charset=utf-8' }),
                                body: JSON.stringify({ error: { status: 404, message: 'page not found' } })
                            })
                        }
                        continue
                    }

                    // serve dist files
                    if (pathname.startsWith('/_aleph/')) {
                        if (pathname.endsWith('.css')) {
                            try {
                                const filePath = path.join(project.buildDir, util.trimPrefix(pathname, '/_aleph/'))
                                const info = await Deno.lstat(filePath)
                                if (!info.isDirectory) {
                                    const body = await Deno.readFile(filePath)
                                    req.respond({
                                        status: 200,
                                        headers: new Headers({ 'Content-Type': 'text/css; charset=utf-8' }),
                                        body
                                    })
                                    continue
                                }
                            } catch (err) {
                                if (!(err instanceof Deno.errors.NotFound)) {
                                    throw err
                                }
                            }
                        } else {
                            const reqSourceMap = pathname.endsWith('.js.map')
                            const mod = project.getModuleByPath(reqSourceMap ? pathname.slice(0, -4) : pathname)
                            if (mod) {
                                const etag = req.headers.get('If-None-Match')
                                if (etag && etag === mod.hash) {
                                    req.respond({ status: 304 })
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
                                req.respond({
                                    status: 200,
                                    headers: new Headers({
                                        'Content-Type': `application/${reqSourceMap ? 'json' : 'javascript'}; charset=utf-8`,
                                        'ETag': mod.hash
                                    }),
                                    body
                                })
                                continue
                            }
                        }
                        req.respond({
                            status: 404,
                            headers: new Headers({ 'Content-Type': 'text/html' }),
                            body: createHtml({
                                lang: 'en',
                                head: ['<title>404 - not found</title>'],
                                body: '<p><strong><code>404</code></strong><small> - </small><span>not found</span></p>'
                            })
                        })
                        continue
                    }

                    // serve public files
                    try {
                        const filePath = path.join(project.appRoot, 'public', pathname)
                        const info = await Deno.lstat(filePath)
                        if (!info.isDirectory) {
                            const body = await Deno.readFile(filePath)
                            req.respond({
                                status: 200,
                                headers: new Headers({ 'Content-Type': getContentType(filePath) }),
                                body
                            })
                            continue
                        }
                    } catch (err) {
                        if (!(err instanceof Deno.errors.NotFound)) {
                            throw err
                        }
                    }

                    if (pathname === '/favicon.ico') {
                        req.respond({
                            status: 404,
                            headers: new Headers({ 'Content-Type': 'text/plain' }),
                            body: 'icon not found'
                        })
                        continue
                    }

                    // ssr
                    const [status, html] = await project.getPageHtml({ pathname, search: url.search })
                    req.respond({
                        status,
                        headers: new Headers({ 'Content-Type': 'text/html' }),
                        body: html
                    })
                } catch (err) {
                    req.respond({
                        status: 500,
                        headers: new Headers({ 'Content-Type': 'text/html' }),
                        body: createHtml({
                            lang: 'en',
                            head: ['<title>500 - internal server error</title>'],
                            body: `<p><strong><code>500</code></strong><small> - </small><span>${err.message}</span></p>`
                        })
                    })
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


