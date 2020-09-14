import { path, serve, ws } from '../deps.ts'
import { createHtml } from '../html.ts'
import log from '../log.ts'
import Project from '../project.ts'
import route from '../route.ts'
import util from '../util.ts'
import { PostAPIRequest, PostAPIResponse } from './api.ts'
import { getContentType } from './mime.ts'

export async function start(appDir: string, port: number, isDev = false) {
    const project = new Project(appDir, isDev ? 'development' : 'production')
    await project.ready

    try {
        const s = serve({ port })
        log.info(`Server ready on http://localhost:${port}`)
        for await (const req of s) {
            const url = new URL('http://localhost/' + req.url)
            const pathname = util.cleanPath(url.pathname)

            try {
                if (pathname === '/_hmr') {
                    const { conn, r: bufReader, w: bufWriter, headers } = req
                    ws.acceptWebSocket({ conn, bufReader, bufWriter, headers }).then(async socket => {
                        const watcher = project.createFSWatcher()
                        for await (const e of socket) {
                            if (util.isNEString(e)) {
                                try {
                                    const data = JSON.parse(e)
                                    if (data.type === 'hotAccept' && util.isNEString(data.id)) {
                                        const mod = project.getModule(data.id)
                                        if (mod) {
                                            watcher.on(mod.id, (type: string, hash?: string) => {
                                                if (type == 'modify') {
                                                    socket.send(JSON.stringify({
                                                        type: 'update',
                                                        id: mod.id,
                                                        updateUrl: path.resolve(path.join(project.config.baseUrl, '/_dist/'), mod.id.replace(/\.js$/, '') + `.${hash!.slice(0, 9)}.js`)
                                                    }))
                                                }
                                            })
                                        }
                                    }
                                } catch (e) { }
                            }
                        }
                        project.removeFSWatcher(watcher)
                    })
                    continue
                }

                //serve apis
                if (pathname.startsWith('/api/')) {
                    const { pagePath, params, query } = route(
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
                            body: 'page not found'
                        })
                    }
                    continue
                }

                // serve js files
                if (pathname.startsWith('/_dist/')) {
                    const reqSourceMap = pathname.endsWith('.js.map')
                    const mod = project.getModuleByPath(reqSourceMap ? pathname.slice(0, -4) : pathname)
                    if (mod) {
                        const etag = req.headers.get('If-None-Match')
                        if (etag && etag === mod.hash) {
                            req.respond({ status: 304 })
                            continue
                        }

                        let body = ''
                        if (reqSourceMap) {
                            body = mod.jsSourceMap
                        } else {
                            body = mod.jsContent
                            if (mod.id === './app.js' || mod.id.startsWith('./pages/')) {
                                const { staticProps } = await project.importModuleAsComponent(mod.id)
                                if (staticProps) {
                                    body = 'export const __staticProps = ' + JSON.stringify(staticProps) + ';\n' + body
                                }
                            }
                            if (project.isHMRable(mod.id)) {
                                body = injectHmr(mod.id, body)
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
                    } else {
                        req.respond({
                            status: 404,
                            headers: new Headers({ 'Content-Type': 'text/html' }),
                            body: createHtml({
                                lang: 'en',
                                head: ['<title>404 - page not found</title>'],
                                body: '<p><strong><code>404</code></strong><small> - </small><span>page not found</span></p>'
                            })
                        })
                    }
                    continue
                }

                // serve public files
                const publicPath = path.join(project.rootDir, 'public', pathname)
                try {
                    const info = await Deno.lstat(publicPath)
                    if (!info.isDirectory) {
                        const body = await Deno.readFile(publicPath)
                        req.respond({
                            status: 200,
                            headers: new Headers({ 'Content-Type': getContentType(publicPath) }),
                            body
                        })
                        continue
                    }
                } catch (err) {
                    if (!(err instanceof Deno.errors.NotFound)) {
                        throw err
                    }
                }

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
            log.error(`address :${port} already in use`)
        } else {
            console.log(err)
        }
        Deno.exit(1)
    }
}

function injectHmr(id: string, jsContent: string) {
    let hmrImportPath = path.relative(
        path.dirname(path.resolve('/', id)),
        '/-/deno.land/x/aleph/hmr.js'
    )
    if (!hmrImportPath.startsWith('.') && !hmrImportPath.startsWith('/')) {
        hmrImportPath = './' + hmrImportPath
    }

    const text = [
        `import { createHotContext, RefreshRuntime, performReactRefresh } from ${JSON.stringify(hmrImportPath)}`,
        `import.meta.hot = createHotContext(${JSON.stringify(id)})`
    ]
    const reactRefresh = id.endsWith('.js')
    if (reactRefresh) {
        text.push('')
        text.push(
            `const prevRefreshReg = window.$RefreshReg$`,
            `const prevRefreshSig = window.$RefreshSig$`,
            `Object.assign(window, {`,
            `    $RefreshReg$: (type, id) => RefreshRuntime.register(type, ${JSON.stringify(id)} + " " + id),`,
            `    $RefreshSig$: RefreshRuntime.createSignatureFunctionForTransform`,
            `})`,
        )
    }
    text.push('')
    text.push(jsContent)
    text.push('')
    if (reactRefresh) {
        text.push(
            'window.$RefreshReg$ = prevRefreshReg',
            'window.$RefreshSig$ = prevRefreshSig',
            'import.meta.hot.accept(performReactRefresh)'
        )
    } else {
        text.push('import.meta.hot.accept()')
    }
    return text.join('\n')
}
