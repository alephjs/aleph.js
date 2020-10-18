import marked from 'https://esm.sh/marked@1.2.0'
import { minify } from 'https://esm.sh/terser@5.3.2'
import { safeLoadFront } from 'https://esm.sh/yaml-front-matter@4.1.0'
import { AlephAPIRequest, AlephAPIResponse } from './api.ts'
import { EventEmitter } from './events.ts'
import { createHtml } from './html.ts'
import log from './log.ts'
import { getPagePath, RouteModule, Routing } from './routing.ts'
import { colors, ensureDir, path, ServerRequest, Sha1, walk } from './std.ts'
import { compile } from './tsc/compile.ts'
import type { AlephRuntime, APIHandle, Config, RouterURL } from './types.ts'
import util, { existsDirSync, existsFileSync, hashShort, MB, reHashJs, reHttp, reLocaleID, reMDExt, reModuleExt, reStyleModuleExt } from './util.ts'
import { cleanCSS, Document, less } from './vendor/mod.ts'
import { version } from './version.ts'

interface Module {
    id: string
    url: string
    isRemote: boolean
    sourceFilePath: string
    sourceType: string
    sourceHash: string
    deps: { url: string, hash: string, async?: boolean }[]
    jsFile: string
    jsContent: string
    jsSourceMap: string
    hash: string
}

interface Renderer {
    renderPage: Function
    renderHead: Function
}

interface RenderResult {
    url: RouterURL
    status: number
    head: string[]
    body: string
    data: Record<string, string> | null
}

export class Project {
    readonly mode: 'development' | 'production'
    readonly appRoot: string
    readonly config: Config
    readonly ready: Promise<void>

    #modules: Map<string, Module> = new Map()
    #routing: Routing = new Routing()
    #apiRouting: Routing = new Routing()
    #fsWatchListeners: Array<EventEmitter> = []
    #renderer: Renderer = { renderPage: () => void 0, renderHead: () => void 0 }
    #rendered: Map<string, Map<string, RenderResult>> = new Map()

    constructor(dir: string, mode: 'development' | 'production', reload = false) {
        this.mode = mode
        this.appRoot = dir
        this.config = {
            srcDir: '/',
            outputDir: '/dist',
            baseUrl: '/',
            defaultLocale: 'en',
            locales: [],
            ssr: {
                fallback: '_fallback.html'
            },
            buildTarget: mode === 'development' ? 'es2018' : 'es2015',
            sourceMap: false,
            importMap: {
                imports: {}
            },
            env: {}
        }
        log.info(colors.bold('Aleph.js'))
        this.ready = (async () => {
            const t = performance.now()
            await this._loadConfig()
            await this._init(reload)
            log.debug('init project in ' + Math.round(performance.now() - t) + 'ms')
        })()
    }

    get isDev() {
        return this.mode === 'development'
    }

    get srcDir() {
        return path.join(this.appRoot, this.config.srcDir)
    }

    get buildDir() {
        return path.join(this.appRoot, '.aleph', this.mode + '.' + this.config.buildTarget)
    }

    isHMRable(moduleID: string) {
        return !reHttp.test(moduleID) && (
            moduleID === '/404.js' ||
            moduleID === '/app.js' ||
            moduleID.startsWith('/pages/') ||
            moduleID.startsWith('/components/') ||
            reStyleModuleExt.test(moduleID)
        )
    }

    isSSRable(pathname: string): boolean {
        const { ssr } = this.config
        if (util.isPlainObject(ssr)) {
            if (ssr.include) {
                for (let r of ssr.include) {
                    if (!r.test(pathname)) {
                        return false
                    }
                }
            }
            if (ssr.exclude) {
                for (let r of ssr.exclude) {
                    if (r.test(pathname)) {
                        return false
                    }
                }
            }
        }
        return true
    }

    getModule(id: string): Module | null {
        if (this.#modules.has(id)) {
            return this.#modules.get(id)!
        }
        return null
    }

    getModuleByPath(pathname: string): Module | null {
        const { baseUrl } = this.config
        let modId = pathname
        if (baseUrl !== '/') {
            modId = util.trimPrefix(modId, baseUrl)
        }
        if (modId.startsWith('/_aleph/')) {
            modId = util.trimPrefix(modId, '/_aleph')
        }
        if (modId.startsWith('/-/')) {
            modId = '//' + util.trimSuffix(util.trimPrefix(modId, '/-/'), '.js')
            if (!reStyleModuleExt.test(modId)) {
                modId = modId + '.js'
            }
        } else if (modId.endsWith('.js')) {
            let id = modId.slice(0, modId.length - 3)
            if (reHashJs.test(modId)) {
                id = modId.slice(0, modId.length - (1 + hashShort + 3))
            }
            if (reMDExt.test(id) || reStyleModuleExt.test(id)) {
                modId = id
            } else {
                modId = id + '.js'
            }
        }
        if (!this.#modules.has(modId)) {
            log.warn(`can't get the module by path '${pathname}(${modId})'`)
        }
        return this.getModule(modId)
    }

    createFSWatcher(): EventEmitter {
        const e = new EventEmitter()
        this.#fsWatchListeners.push(e)
        return e
    }

    removeFSWatcher(e: EventEmitter) {
        e.removeAllListeners()
        const index = this.#fsWatchListeners.indexOf(e)
        if (index > -1) {
            this.#fsWatchListeners.splice(index, 1)
        }
    }

    async callAPI(req: ServerRequest, loc: { pathname: string, search?: string }): Promise<APIHandle | null> {
        const [url] = this.#apiRouting.createRouter(loc)
        if (url.pagePath != '') {
            const moduleID = url.pagePath + '.js'
            if (this.#modules.has(moduleID)) {
                try {
                    const { default: handle } = await import('file://' + this.#modules.get(moduleID)!.jsFile)
                    if (util.isFunction(handle)) {
                        await handle(
                            new AlephAPIRequest(req, url),
                            new AlephAPIResponse(req)
                        )
                    } else {
                        req.respond({
                            status: 500,
                            headers: new Headers({ 'Content-Type': 'application/json; charset=utf-8' }),
                            body: JSON.stringify({ error: { status: 404, message: "handle not found" } })
                        }).catch(err => log.warn('ServerRequest.respond:', err.message))
                    }
                } catch (err) {
                    req.respond({
                        status: 500,
                        headers: new Headers({ 'Content-Type': 'application/json; charset=utf-8' }),
                        body: JSON.stringify({ error: { status: 500, message: err.message } })
                    }).catch(err => log.warn('ServerRequest.respond:', err.message))
                    log.error('callAPI:', err)
                }
            }
        } else {
            req.respond({
                status: 404,
                headers: new Headers({ 'Content-Type': 'application/javascript; charset=utf-8' }),
                body: JSON.stringify({ error: { status: 404, message: 'page not found' } })
            }).catch(err => log.warn('ServerRequest.respond:', err.message))
        }
        return null
    }

    async getPageData(loc: { pathname: string, search?: string }): Promise<[number, any]> {
        if (!this.isSSRable(loc.pathname)) {
            return [404, null]
        }

        const { status, data } = await this._renderPage(loc)
        return [status, data]
    }

    async getPageHtml(loc: { pathname: string, search?: string }): Promise<[number, string]> {
        if (!this.isSSRable(loc.pathname)) {
            const [url] = this.#routing.createRouter(loc)
            return [url.pagePath === '' ? 404 : 200, this.getSPAIndexHtml()]
        }

        const { baseUrl } = this.config
        const mainModule = this.#modules.get('/main.js')!
        const { url, status, head, body, data } = await this._renderPage(loc)
        const html = createHtml({
            lang: url.locale,
            head: head,
            scripts: [
                data ? { type: 'application/json', innerText: JSON.stringify(data), id: 'ssr-data' } : '',
                { src: path.join(baseUrl, `/_aleph/main.${mainModule.hash.slice(0, hashShort)}.js`), type: 'module' },
                { src: path.join(baseUrl, `/_aleph/-/deno.land/x/aleph/nomodule.js${this.isDev ? '?dev' : ''}`), nomodule: true },
            ],
            body,
            minify: !this.isDev
        })
        return [status, html]
    }

    getSPAIndexHtml(): string {
        const { baseUrl, defaultLocale } = this.config
        const mainModule = this.#modules.get('/main.js')!
        const html = createHtml({
            lang: defaultLocale,
            scripts: [
                { src: path.join(baseUrl, `/_aleph/main.${mainModule.hash.slice(0, hashShort)}.js`), type: 'module' },
                { src: path.join(baseUrl, `/_aleph/-/deno.land/x/aleph/nomodule.js${this.isDev ? '?dev' : ''}`), nomodule: true },
            ],
            body: `<main><p><em>Loading...</em></p></main>`, // todo: custom `loading` page
            minify: !this.isDev
        })
        return html
    }

    async build() {
        const start = performance.now()
        const outputDir = path.join(this.srcDir, this.config.outputDir)
        const distDir = path.join(outputDir, '_aleph')
        const outputModules = new Set<string>()
        const lookup = async (moduleID: string) => {
            if (this.#modules.has(moduleID) && !outputModules.has(moduleID)) {
                outputModules.add(moduleID)
                const { deps } = this.#modules.get(moduleID)!
                deps.forEach(({ url }) => {
                    const { id } = this._moduleFromURL(url)
                    lookup(id)
                })
            }
        }

        // wait for project ready
        await this.ready

        // lookup output modules
        this.#routing.lookup(path => path.forEach(r => lookup(r.module.id)))
        lookup('/main.js')
        lookup('/404.js')
        lookup('/app.js')
        lookup('//deno.land/x/aleph/nomodule.js')
        lookup('//deno.land/x/aleph/tsc/tslib.js')

        if (existsDirSync(outputDir)) {
            await Deno.remove(outputDir, { recursive: true })
        }
        await ensureDir(outputDir)
        await ensureDir(distDir)

        // ssg
        const { ssr } = this.config
        const SPAIndexHtml = this.getSPAIndexHtml()
        if (ssr) {
            log.info(colors.bold('  Pages (SSG)'))
            const paths = new Set(this.#routing.paths)
            if (typeof ssr === 'object' && ssr.staticPaths) {
                ssr.staticPaths.forEach(path => paths.add(path))
            }
            await Promise.all(Array.from(paths).map(async pathname => {
                if (this.isSSRable(pathname)) {
                    const [status, html] = await this.getPageHtml({ pathname })
                    if (status == 200) {
                        const [_, data] = await this.getPageData({ pathname })
                        const htmlFile = path.join(outputDir, pathname, 'index.html')
                        const dataFile = path.join(outputDir, '_aleph/data', pathname, 'data.js')
                        await writeTextFile(htmlFile, html)
                        if (data) {
                            await writeTextFile(dataFile, `export default ` + JSON.stringify(data))
                        }
                        log.info('    ○', pathname, colors.dim('• ' + util.bytesString(html.length)))
                    } else if (status == 404) {
                        log.info('    ○', colors.dim(pathname), colors.red(`Page not found`))
                    } else if (status == 500) {
                        log.info('    ○', colors.dim(pathname), colors.red(`Error 505`))
                    }
                }
            }))
            const fbHtmlFile = path.join(outputDir, util.isPlainObject(ssr) && ssr.fallback ? ssr.fallback : '_fallback.html')
            await writeTextFile(fbHtmlFile, SPAIndexHtml)
        } else {
            await writeTextFile(path.join(outputDir, 'index.html'), SPAIndexHtml)
        }

        // write 404 page
        const { baseUrl } = this.config
        const { url, head, body, data } = await this._render404Page()
        const mainModule = this.#modules.get('/main.js')!
        const e404PageHtml = createHtml({
            lang: url.locale,
            head: head,
            scripts: [
                data ? { type: 'application/json', innerText: JSON.stringify(data), id: 'ssr-data' } : '',
                { src: path.join(baseUrl, `/_aleph/main.${mainModule.hash.slice(0, hashShort)}.js`), type: 'module' },
                { src: path.join(baseUrl, `/_aleph/-/deno.land/x/aleph/nomodule.js${this.isDev ? '?dev' : ''}`), nomodule: true },
            ],
            body,
            minify: !this.isDev
        })
        await writeTextFile(path.join(outputDir, '404.html'), e404PageHtml)

        // copy public assets
        const publicDir = path.join(this.appRoot, 'public')
        if (existsDirSync(publicDir)) {
            log.info(colors.bold('  Public Assets'))
            for await (const { path: p } of walk(publicDir, { includeDirs: false, skip: [/\/\.[^\/]+($|\/)/] })) {
                const rp = util.trimPrefix(p, publicDir)
                const fp = path.join(outputDir, rp)
                const fi = await Deno.lstat(p)
                await ensureDir(path.dirname(fp))
                await Deno.copyFile(p, fp)
                log.info('    ✹', rp, colors.dim('•'), colorfulBytesString(fi.size))
            }
        }

        const moduleState = {
            deps: { bytes: 0, count: 0 },
            modules: { bytes: 0, count: 0 },
            styles: { bytes: 0, count: 0 }
        }
        const logModule = (key: 'deps' | 'modules' | 'styles', size: number) => {
            moduleState[key].bytes += size
            moduleState[key].count++
        }

        // write modules
        const { sourceMap } = this.config
        await Promise.all(Array.from(outputModules).map((moduleID) => {
            const { sourceFilePath, sourceType, isRemote, jsContent, jsSourceMap, hash } = this.#modules.get(moduleID)!
            const saveDir = path.join(distDir, path.dirname(sourceFilePath))
            const name = path.basename(sourceFilePath).replace(reModuleExt, '')
            const jsFile = path.join(saveDir, name + (isRemote ? '' : '.' + hash.slice(0, hashShort))) + '.js'
            if (isRemote) {
                logModule('deps', jsContent.length)
            } else {
                if (sourceType === 'css' || sourceType === 'less') {
                    logModule('styles', jsContent.length)
                } else {
                    logModule('modules', jsContent.length)
                }
            }
            return Promise.all([
                writeTextFile(jsFile, jsContent),
                sourceMap && jsSourceMap ? writeTextFile(jsFile + '.map', jsSourceMap) : Promise.resolve(),
            ])
        }))

        const { deps, modules, styles } = moduleState
        log.info(colors.bold('  Modules'))
        log.info('    {}', colors.bold(deps.count.toString()), 'deps', colors.dim(`• ${util.bytesString(deps.bytes)} (mini, uncompress)`))
        log.info('    {}', colors.bold(modules.count.toString()), 'modules', colors.dim(`• ${util.bytesString(modules.bytes)} (mini, uncompress)`))
        log.info('    {}', colors.bold(styles.count.toString()), 'styles', colors.dim(`• ${util.bytesString(styles.bytes)} (mini, uncompress)`))

        log.info(`Done in ${Math.round(performance.now() - start)}ms`)
    }

    private async _loadConfig() {
        const { ALEPH_IMPORT_MAP } = globalThis as any
        if (ALEPH_IMPORT_MAP) {
            const { imports } = ALEPH_IMPORT_MAP
            Object.assign(this.config.importMap, { imports: Object.assign({}, this.config.importMap.imports, imports) })
        }

        const importMapFile = path.join(this.appRoot, 'import_map.json')
        if (existsFileSync(importMapFile)) {
            const { imports } = JSON.parse(await Deno.readTextFile(importMapFile))
            Object.assign(this.config.importMap, { imports: Object.assign({}, this.config.importMap.imports, imports) })
        }

        const config: Record<string, any> = {}
        for await (const { path: p } of walk(this.srcDir, { includeDirs: false, exts: ['.js', '.mjs', '.ts', '.json'], skip: [/\.d\.ts$/i], maxDepth: 1 })) {
            const name = path.basename(p)
            if (name.split('.')[0] === 'config') {
                log.info(colors.bold('  Config'))
                log.info('    ⚙️', name)
                if (name.endsWith('.json')) {
                    try {
                        const conf = JSON.parse(await Deno.readTextFile(p))
                        Object.assign(config, conf)
                    } catch (e) {
                        log.fatal('parse config.json:', e.message)
                    }
                } else {
                    const { default: conf } = await import('file://' + p)
                    if (util.isPlainObject(conf)) {
                        Object.assign(config, conf)
                    }
                }
            }
        }

        const {
            srcDir,
            ouputDir,
            baseUrl,
            buildTarget,
            sourceMap,
            defaultLocale,
            locales,
            ssr,
            env
        } = config
        if (util.isNEString(srcDir)) {
            Object.assign(this.config, { srcDir: util.cleanPath(srcDir) })
        }
        if (util.isNEString(ouputDir)) {
            Object.assign(this.config, { ouputDir: util.cleanPath(ouputDir) })
        }
        if (util.isNEString(baseUrl)) {
            Object.assign(this.config, { baseUrl: util.cleanPath(encodeURI(baseUrl)) })
        }
        if (/^es(20\d{2}|next)$/i.test(buildTarget)) {
            Object.assign(this.config, { buildTarget: buildTarget.toLowerCase() })
        }
        if (typeof sourceMap === 'boolean') {
            Object.assign(this.config, { sourceMap })
        }
        if (util.isNEString(defaultLocale)) {
            Object.assign(this.config, { defaultLocale })
        }
        if (util.isArray(locales)) {
            Object.assign(this.config, { locales: Array.from(new Set(locales.filter(l => reLocaleID.test(l)))) })
            locales.filter(l => !reLocaleID.test(l)).forEach(l => log.warn(`invalid locale ID '${l}'`))
        }
        if (typeof ssr === 'boolean') {
            Object.assign(this.config, { ssr })
        } else if (util.isPlainObject(ssr)) {
            const fallback = util.isNEString(ssr.fallback) ? util.ensureExt(ssr.fallback, '.html') : '404.html'
            const include = util.isArray(ssr.include) ? ssr.include.map(v => util.isNEString(v) ? new RegExp(v) : v).filter(v => v instanceof RegExp) : []
            const exclude = util.isArray(ssr.exclude) ? ssr.exclude.map(v => util.isNEString(v) ? new RegExp(v) : v).filter(v => v instanceof RegExp) : []
            const staticPaths = util.isArray(ssr.staticPaths) ? ssr.staticPaths.map(v => util.cleanPath(v)) : []
            Object.assign(this.config, { ssr: { fallback, include, exclude, staticPaths } })
        }
        if (util.isPlainObject(env)) {
            Object.assign(this.config, { env })
        }
        // Update buildID
        Object.assign(this, { buildID: this.mode + '.' + this.config.buildTarget })
        // Update routing options.
        this.#routing = new Routing([], this.config.baseUrl, this.config.defaultLocale, this.config.locales)
    }

    private async _init(reload: boolean) {
        const walkOptions = { includeDirs: false, exts: ['.js', '.ts', '.mjs'], skip: [/^\./, /\.d\.ts$/i, /\.(test|spec|e2e)\.m?(j|t)sx?$/i] }
        const apiDir = path.join(this.srcDir, 'api')
        const pagesDir = path.join(this.srcDir, 'pages')

        if (!(existsDirSync(pagesDir))) {
            log.fatal(`'pages' directory not found.`)
        }

        if (reload) {
            if (existsDirSync(this.buildDir)) {
                await Deno.remove(this.buildDir, { recursive: true })
            }
            await ensureDir(this.buildDir)
        }

        Object.assign(globalThis, {
            ALEPH: {
                env: { ...this.config.env },
                __version: version,
                __appRoot: this.appRoot,
                __buildMode: this.mode,
                __buildTarget: this.config.buildTarget,
            } as AlephRuntime,
            document: new Document(),
            innerWidth: 1920,
            innerHeight: 1080,
            devicePixelRatio: 1,
            $RefreshReg$: () => { },
            $RefreshSig$: () => (type: any) => type,
        })

        for await (const { path: p, } of walk(this.srcDir, { ...walkOptions, maxDepth: 1, exts: [...walkOptions.exts, '.jsx', '.tsx'] })) {
            const name = path.basename(p)
            switch (name.replace(reModuleExt, '')) {
                case 'app':
                case '404':
                    await this._compile('/' + name)
                    break
            }
        }

        if (existsDirSync(apiDir)) {
            for await (const { path: p } of walk(apiDir, walkOptions)) {
                const mod = await this._compile('/api' + util.trimPrefix(p, apiDir))
                this.#apiRouting.update(this._getRouteModule(mod))
            }
        }

        for await (const { path: p } of walk(pagesDir, { ...walkOptions, exts: [...walkOptions.exts, '.jsx', '.tsx', '.md', '.mdx'] })) {
            const rp = util.trimPrefix(p, pagesDir)
            const mod = await this._compile('/pages' + rp)
            this.#routing.update(this._getRouteModule(mod))
        }

        const precompileUrls = [
            'https://deno.land/x/aleph/bootstrap.ts',
            'https://deno.land/x/aleph/renderer.ts',
            'https://deno.land/x/aleph/nomodule.ts',
            'https://deno.land/x/aleph/tsc/tslib.js',
        ]
        if (this.isDev) {
            precompileUrls.push('https://deno.land/x/aleph/hmr.ts')
        }
        for (const url of precompileUrls) {
            await this._compile(url)
        }
        await this._createMainModule()

        // ensure react in deno is same with browser one
        const { renderPage, renderHead } = await import('file://' + this.#modules.get('//deno.land/x/aleph/renderer.js')!.jsFile)
        this.#renderer = { renderPage, renderHead }

        log.info(colors.bold('  Global'))
        if (this.#modules.has('/app.js')) {
            log.info('    ✓', 'Custom App')
        }
        if (this.#modules.has('/404.js')) {
            log.info('    ✓', 'Custom 404 Page')
        }
        if (this.#modules.has('/loading.js')) {
            log.info('    ✓', 'Custom Loading Page')
        }

        if (this.isDev) {
            if (this.#apiRouting.paths.length > 0) {
                log.info(colors.bold('  APIs'))
            }
            for (const path of this.#apiRouting.paths) {
                log.info('    λ', path)
            }
            log.info(colors.bold('  Pages'))
            for (const path of this.#routing.paths) {
                const isIndex = path == '/'
                log.info('    ○', path, isIndex ? colors.dim('(index)') : '')
            }
        }

        if (this.isDev) {
            this._watch()
        }
    }

    private async _watch() {
        const w = Deno.watchFs(this.srcDir, { recursive: true })
        log.info('Start watching code changes...')
        for await (const event of w) {
            for (const p of event.paths) {
                const path = '/' + util.trimPrefix(util.trimPrefix(p, this.appRoot), '/')
                // handle `api` dir remove directly
                const validated = (() => {
                    if (!reModuleExt.test(path) && !reStyleModuleExt.test(path) && !reMDExt.test(path)) {
                        return false
                    }
                    // ignore `.aleph` and output directories
                    if (path.startsWith('/.aleph/') || path.startsWith(this.config.outputDir)) {
                        return false
                    }
                    if (reModuleExt.test(path)) {
                        switch (path.replace(reModuleExt, '')) {
                            case '/404':
                            case '/app':
                                return true
                            default:
                                if (path.startsWith('/api/')) {
                                    return true
                                }
                        }
                    }
                    if ((reModuleExt.test(path) || reMDExt.test(path)) && path.startsWith('/pages/')) {
                        return true
                    }
                    let isDep = false
                    for (const { deps } of this.#modules.values()) {
                        if (deps.findIndex(dep => dep.url === path) > -1) {
                            isDep = true
                            break
                        }
                    }
                    return isDep
                })()
                if (validated) {
                    const moduleID = path.replace(reModuleExt, '.js')
                    util.debounceX(moduleID, () => {
                        const shouldUpdateMainModule = (() => {
                            switch (moduleID) {
                                case '/404.js':
                                case '/app.js':
                                    return true
                                default:
                                    if (moduleID.startsWith('/pages/')) {
                                        return true
                                    }
                                    return false
                            }
                        })()
                        if (existsFileSync(p)) {
                            let type = 'modify'
                            if (!this.#modules.has(moduleID)) {
                                type = 'add'
                            }
                            log.info(type, path)
                            this._compile(path, { forceCompile: true }).then(mod => {
                                const hmrable = this.isHMRable(mod.id)
                                if (hmrable) {
                                    if (type === 'add') {
                                        this.#fsWatchListeners.forEach(e => e.emit('add', mod.id, mod.hash))
                                    } else {
                                        this.#fsWatchListeners.forEach(e => e.emit('modify-' + mod.id, mod.hash))
                                    }
                                }
                                if (moduleID === '/app.js') {
                                    this.#rendered.clear()
                                } else if (moduleID.startsWith('/pages/')) {
                                    this.#rendered.delete(getPagePath(moduleID))
                                    this.#routing.update(this._getRouteModule(mod))
                                } else if (moduleID.startsWith('/api/')) {
                                    this.#apiRouting.update(this._getRouteModule(mod))
                                }
                                if (shouldUpdateMainModule) {
                                    this._createMainModule()
                                }
                                this._updateDependency(path, mod.hash, ({ id, hash }) => {
                                    if (id.startsWith('/pages/')) {
                                        this.#rendered.delete(getPagePath(id))
                                    }
                                    if (!hmrable && this.isHMRable(id)) {
                                        this.#fsWatchListeners.forEach(e => e.emit('modify-' + id, hash))
                                    }
                                })
                            }).catch(err => {
                                log.error(`compile(${path}):`, err.message)
                            })
                        } else if (this.#modules.has(moduleID)) {
                            if (moduleID === '/app.js') {
                                this.#rendered.clear()
                            } else if (moduleID.startsWith('/pages/')) {
                                this.#rendered.delete(getPagePath(moduleID))
                                this.#routing.removeRoute(moduleID)
                            } else if (moduleID.startsWith('/api/')) {
                                this.#apiRouting.removeRoute(moduleID)
                            }
                            if (shouldUpdateMainModule) {
                                this._createMainModule()
                            }
                            this.#modules.delete(moduleID)
                            if (this.isHMRable(moduleID)) {
                                this.#fsWatchListeners.forEach(e => e.emit('remove', moduleID))
                            }
                            log.info('remove', path)
                        }
                    }, 150)
                }
            }
        }
    }

    private _getRouteModule({ id, hash }: Module): RouteModule {
        const asyncDeps = this._lookupAsyncDeps(id).filter(({ async }) => !!async).map(({ async, ...rest }) => rest)
        return { id, hash, asyncDeps: asyncDeps.length > 0 ? asyncDeps : undefined }
    }

    private _moduleFromURL(url: string): Module {
        const { importMap } = this.config
        const isRemote = reHttp.test(url) || (url in importMap.imports && reHttp.test(importMap.imports[url]))
        const sourceFilePath = renameImportUrl(url)
        const id = (isRemote ? '//' + util.trimPrefix(sourceFilePath, '/-/') : sourceFilePath).replace(reModuleExt, '.js')
        return {
            id,
            url,
            isRemote,
            sourceFilePath,
            sourceType: path.extname(sourceFilePath).slice(1).replace('mjs', 'js') || 'js',
            sourceHash: '',
            deps: [],
            jsFile: '',
            jsContent: '',
            jsSourceMap: '',
            hash: '',
        } as Module
    }

    private async _createMainModule(): Promise<Module> {
        const { baseUrl, defaultLocale } = this.config
        const config: Record<string, any> = {
            baseUrl,
            defaultLocale,
            locales: [],
            routes: this.#routing.routes,
            preloadModules: ['/404.js', '/app.js'].filter(id => this.#modules.has(id)).map(id => {
                return this._getRouteModule(this.#modules.get(id)!)
            })
        }
        const module = this._moduleFromURL('/main.js')
        const metaFile = path.join(this.buildDir, 'main.meta.json')
        const deps = [
            this.isDev && 'https://deno.land/x/aleph/hmr.ts',
            'https://deno.land/x/aleph/bootstrap.ts'
        ].filter(Boolean).map(url => ({
            url: String(url),
            hash: this.#modules.get(String(url).replace(reHttp, '//').replace(reModuleExt, '.js'))?.hash || ''
        }))

        module.jsContent = [
            this.isDev && 'import "./-/deno.land/x/aleph/hmr.js";',
            'import bootstrap from "./-/deno.land/x/aleph/bootstrap.js";',
            `bootstrap(${JSON.stringify(config, undefined, this.isDev ? 4 : undefined)});`
        ].filter(Boolean).join(this.isDev ? '\n' : '')
        module.hash = getHash(module.jsContent)
        module.jsFile = path.join(this.buildDir, `main.${module.hash.slice(0, hashShort)}.js`)
        module.deps = deps

        try {
            let prevHash = ''
            if (this.#modules.has(module.id)) {
                prevHash = this.#modules.get(module.id)!.hash
            } else if (existsFileSync(metaFile)) {
                const { hash } = JSON.parse(await Deno.readTextFile(metaFile))
                if (util.isNEString(hash)) {
                    prevHash = hash
                }
            }
            if (prevHash !== '') {
                await Deno.remove(path.join(this.buildDir, `main.${prevHash.slice(0, hashShort)}.js`))
            }
        } catch (e) { }

        await Promise.all([
            writeTextFile(module.jsFile, module.jsContent),
            writeTextFile(metaFile, JSON.stringify({
                url: '/main.js',
                sourceHash: module.hash,
                hash: module.hash,
                deps: module.deps,
            }, undefined, 4))
        ])
        this.#modules.set(module.id, module)

        return module
    }

    // todo: force recompile remote modules which URL don't specify version
    private async _compile(url: string, options?: { sourceCode?: string, forceCompile?: boolean }) {
        const mod = this._moduleFromURL(url)
        if (this.#modules.has(mod.id) && !options?.forceCompile) {
            return this.#modules.get(mod.id)!
        }

        const { importMap } = this.config
        const name = path.basename(mod.sourceFilePath).replace(reModuleExt, '')
        const saveDir = path.join(this.buildDir, path.dirname(mod.sourceFilePath))
        const metaFile = path.join(saveDir, `${name}.meta.json`)

        if (existsFileSync(metaFile)) {
            const { sourceHash, hash, deps } = JSON.parse(await Deno.readTextFile(metaFile))
            const jsFile = path.join(saveDir, name + (mod.isRemote ? '' : '.' + hash.slice(0, hashShort))) + '.js'
            if (util.isNEString(sourceHash) && util.isNEString(hash) && util.isArray(deps) && existsFileSync(jsFile)) {
                try {
                    mod.jsContent = await Deno.readTextFile(jsFile)
                    if (existsFileSync(jsFile + '.map')) {
                        mod.jsSourceMap = await Deno.readTextFile(jsFile + '.map')
                    }
                    mod.jsFile = jsFile
                    mod.hash = hash
                    mod.deps = deps
                    mod.sourceHash = sourceHash
                } catch (e) { }
            }
        }

        let sourceContent = ''
        let shouldCompile = false
        if (options?.sourceCode) {
            const sourceHash = getHash(options.sourceCode, true)
            if (mod.sourceHash === '' || mod.sourceHash !== sourceHash) {
                mod.sourceHash = sourceHash
                sourceContent = options.sourceCode
                shouldCompile = true
            }
        } else if (mod.isRemote) {
            let dlUrl = url
            for (const importPath in importMap.imports) {
                const alias = importMap.imports[importPath]
                if (importPath === url) {
                    dlUrl = alias
                    break
                } else if (importPath.endsWith('/') && url.startsWith(importPath)) {
                    dlUrl = util.trimSuffix(alias, '/') + '/' + util.trimPrefix(url, importPath)
                    break
                }
            }
            if (dlUrl.startsWith('https://esm.sh/[')) {
                dlUrl.replace(/\[([^\]]+)\]/, (_, s: string) => {
                    const list = s.split(',').map(s => s.trim())
                    if (list.length > 0) {
                        const mod = util.trimPrefix(url, 'https://esm.sh/').replace(/\/+$/, '')
                        if (!list.includes(mod)) {
                            dlUrl = url
                        }
                    }
                    return _
                })
            }
            if (url.startsWith('https://esm.sh/')) {
                const u = new URL(dlUrl)
                u.searchParams.set('target', this.config.buildTarget)
                if (this.isDev && !u.searchParams.has('dev')) {
                    u.searchParams.set('dev', '')
                }
                dlUrl = u.toString().replace(/=(&|$)/, '$1')
            } else if (dlUrl.startsWith('https://deno.land/x/aleph/')) {
                dlUrl = `https://deno.land/x/aleph@v${version}/` + util.trimPrefix(dlUrl, 'https://deno.land/x/aleph/')
            }
            if (mod.sourceHash === '') {
                log.info('Download', url, dlUrl != url ? colors.dim(`• ${dlUrl}`) : '')
                try {
                    const resp = await fetch(dlUrl)
                    if (resp.status != 200) {
                        throw new Error(`Download ${url}: ${resp.status} - ${resp.statusText}`)
                    }
                    if (mod.sourceType === 'js') {
                        const t = resp.headers.get('Content-Type')
                        if (t?.startsWith('text/typescript')) {
                            mod.sourceType = 'ts'
                        } else if (t?.startsWith('text/jsx')) {
                            mod.sourceType = 'jsx'
                        }
                    }
                    mod.sourceHash = getHash(sourceContent)
                    sourceContent = await resp.text()
                    shouldCompile = true
                } catch (err) {
                    throw new Error(`Download ${url}: ${err.message}`)
                }
            } else if (/^https?:\/\/(localhost|127.0.0.1)(:\d+)?\//.test(dlUrl)) {
                try {
                    const resp = await fetch(dlUrl)
                    if (resp.status != 200) {
                        throw new Error(`${resp.status} - ${resp.statusText}`)
                    }
                    const text = await resp.text()
                    const sourceHash = getHash(text, true)
                    if (mod.sourceHash !== sourceHash) {
                        mod.sourceHash = sourceHash
                        sourceContent = text
                        shouldCompile = true
                    }
                } catch (err) {
                    throw new Error(`Download ${url}: ${err.message}`)
                }
            }
        } else {
            const filepath = path.join(this.srcDir, url)
            try {
                const fileinfo = await Deno.stat(filepath)
                // 10mb limit
                if (fileinfo.size > 10 * (1 << 20)) {
                    throw new Error(`ignored module '${url}': too large(${(fileinfo.size / (1 << 20)).toFixed(2)}mb)`)
                }
            } catch (err) {
                if (err instanceof Deno.errors.NotFound) {
                    throw new Error(`module '${url}' not found`)
                }
            }
            const text = await Deno.readTextFile(filepath)
            const sourceHash = getHash(text, true)
            if (mod.sourceHash === '' || mod.sourceHash !== sourceHash) {
                mod.sourceHash = sourceHash
                sourceContent = text
                shouldCompile = true
            }
        }

        let fsync = false

        // compile source code
        if (shouldCompile) {
            const t = performance.now()
            mod.deps = []
            if (mod.sourceType === 'css' || mod.sourceType === 'less') {
                let css: string = sourceContent
                if (mod.sourceType === 'less') {
                    try {
                        // todo: sourceMap
                        const output = await less.render(sourceContent || '/* empty content */')
                        css = output.css
                    } catch (error) {
                        throw new Error(`less: ${error}`);
                    }
                }
                if (this.isDev) {
                    css = String(css).trim()
                } else {
                    const output = cleanCSS.minify(css)
                    css = output.styles
                }
                mod.jsContent = [
                    `import { applyCSS } from ${JSON.stringify(relativePath(
                        path.dirname(mod.url),
                        '/-/deno.land/x/aleph/head.js'
                    ))};`,
                    `applyCSS(${JSON.stringify(url)}, ${JSON.stringify(this.isDev ? `\n${css}\n` : css)});`,
                ].join(this.isDev ? '\n' : '')
                mod.jsSourceMap = ''
                mod.hash = getHash(css)
            } else if (mod.sourceType === 'sass' || mod.sourceType === 'scss') {
                // todo: support sass
            } else if (mod.sourceType === 'mdx') {
                // todo: support mdx
            } else if (mod.sourceType === 'md' || mod.sourceType === 'markdown') {
                const { __content, ...props } = safeLoadFront(sourceContent)
                const html = marked.parse(__content)
                mod.jsContent = [
                    this.isDev && `const _s = $RefreshSig$();`,
                    `import React, { useEffect, useRef } from ${JSON.stringify(relativePath(path.dirname(mod.sourceFilePath), '/-/esm.sh/react.js'))};`,
                    `import { redirect } from ${JSON.stringify(relativePath(path.dirname(mod.sourceFilePath), '/-/deno.land/x/aleph/aleph.js'))};`,
                    `export default function MarkdownPage() {`,
                    this.isDev && `  _s();`,
                    `  const ref = useRef(null);`,
                    `  useEffect(() => {`,
                    `    const appLinks = [];`,
                    `    const onClick = e => {`,
                    `      e.preventDefault();`,
                    `      redirect(e.currentTarget.getAttribute("href"));`,
                    `    };`,
                    `    if (ref.current) {`,
                    `      ref.current.querySelectorAll("a").forEach(a => {`,
                    `        const href = a.getAttribute("href");`,
                    `        if (href && !/^(https?|mailto|file):/i.test(href)) {`,
                    `          a.addEventListener("click", onClick, false);`,
                    `          appLinks.push(a);`,
                    `        }`,
                    `      });`,
                    `    }`,
                    `    return () => appLinks.forEach(a => a.removeEventListener("click", onClick));`,
                    `  }, []);`,
                    `  return React.createElement("div", {className: "markdown-page", ref, dangerouslySetInnerHTML: {__html: ${JSON.stringify(html)}}});`,
                    `}`,
                    `MarkdownPage.meta = ${JSON.stringify(props, undefined, this.isDev ? 4 : undefined)};`,
                    this.isDev && `_s(MarkdownPage, "useRef{ref}\\nuseEffect{}");`,
                    this.isDev && `$RefreshReg$(MarkdownPage, "MarkdownPage");`,
                ].filter(Boolean).map(l => !this.isDev ? String(l).trim() : l).join(this.isDev ? '\n' : '')
                mod.jsSourceMap = ''
                mod.hash = getHash(mod.jsContent)
            } else {
                const useDenos: string[] = []
                const compileOptions = {
                    mode: this.mode,
                    target: this.config.buildTarget,
                    reactRefresh: this.isDev && !mod.isRemote,
                    rewriteImportPath: (path: string, async?: boolean) => this._rewriteImportPath(mod, path, async),
                    signUseDeno: (id: string) => {
                        const sig = 'useDeno.' + (new Sha1()).update(id).update(version).update(Date.now().toString()).hex().slice(0, hashShort)
                        useDenos.push(sig)
                        return sig
                    }
                }
                const { diagnostics, outputText, sourceMapText } = compile(mod.sourceFilePath, sourceContent, compileOptions)
                if (diagnostics && diagnostics.length > 0) {
                    throw new Error(`compile ${url}: ${diagnostics.map(d => d.messageText).join('\n')}`)
                }
                const jsContent = outputText.replace(/import\s*{([^}]+)}\s*from\s*("|')tslib("|');?/g, 'import {$1} from ' + JSON.stringify(relativePath(
                    path.dirname(mod.sourceFilePath),
                    '/-/deno.land/x/aleph/tsc/tslib.js'
                )) + ';')
                if (this.isDev) {
                    mod.jsContent = jsContent
                    mod.jsSourceMap = sourceMapText!
                } else {
                    const { code, map } = await minify(jsContent, {
                        compress: false,
                        mangle: true,
                        sourceMap: {
                            content: sourceMapText!,
                        }
                    })
                    if (code) {
                        mod.jsContent = code
                    } else {
                        mod.jsContent = jsContent
                    }
                    if (util.isNEString(map)) {
                        mod.jsSourceMap = map
                    }
                }
                mod.hash = getHash(mod.jsContent)
                useDenos.forEach(sig => {
                    mod.deps.push({ url: '#' + sig, hash: '', async: true })
                })
            }

            log.debug(`compile '${url}' in ${Math.round(performance.now() - t)}ms`)

            if (!fsync) {
                fsync = true
            }
        }

        this.#modules.set(mod.id, mod)

        // compile deps
        for (const dep of mod.deps.filter(({ url }) => !url.startsWith('#useDeno.'))) {
            const depMod = await this._compile(dep.url)
            if (dep.hash !== depMod.hash) {
                dep.hash = depMod.hash
                if (!reHttp.test(dep.url)) {
                    const depImportPath = relativePath(
                        path.dirname(url),
                        dep.url.replace(reModuleExt, '')
                    )
                    mod.jsContent = mod.jsContent.replace(/(import|Import|export)([\s\S]*?)(from\s*:?\s*|\()("|')([^'"]+)("|')(\)|;)?/g, (s, key, fields, from, ql, importPath, qr, end) => {
                        if (
                            reHashJs.test(importPath) &&
                            importPath.slice(0, importPath.length - (hashShort + 4)) === depImportPath
                        ) {
                            return `${key}${fields}${from}${ql}${depImportPath}.${dep.hash.slice(0, hashShort)}.js${qr}${end || ''}`
                        }
                        return s
                    })
                    mod.hash = getHash(mod.jsContent)
                }
                if (!fsync) {
                    fsync = true
                }
            }
        }

        if (fsync) {
            if (mod.jsFile != '') {
                try {
                    await Deno.remove(mod.jsFile)
                    await Deno.remove(mod.jsFile + '.map')
                } catch (e) { }
            }
            mod.jsFile = path.join(saveDir, name + (mod.isRemote ? '' : `.${mod.hash.slice(0, hashShort)}`)) + '.js'
            await Promise.all([
                writeTextFile(metaFile, JSON.stringify({
                    url,
                    sourceHash: mod.sourceHash,
                    hash: mod.hash,
                    deps: mod.deps,
                }, undefined, 4)),
                writeTextFile(mod.jsFile, mod.jsContent),
                mod.jsSourceMap !== '' ? writeTextFile(mod.jsFile + '.map', mod.jsSourceMap) : Promise.resolve()
            ])
        }

        return mod
    }

    private _updateDependency(depPath: string, depHash: string, callback: (mod: Module) => void, tracing = new Set<string>()) {
        this.#modules.forEach(mod => {
            mod.deps.forEach(dep => {
                if (dep.url === depPath && dep.hash !== depHash && !tracing?.has(mod.id)) {
                    const depImportPath = relativePath(
                        path.dirname(mod.url),
                        dep.url.replace(reModuleExt, '')
                    )
                    dep.hash = depHash
                    if (mod.id === '/main.js') {
                        this._createMainModule()
                    } else {
                        mod.jsContent = mod.jsContent.replace(/(import|export)([^'"]*)("|')([^'"]+)("|')(\)|;)?/g, (s, key, from, ql, importPath, qr, end) => {
                            if (
                                reHashJs.test(importPath) &&
                                importPath.slice(0, importPath.length - (hashShort + 4)) === depImportPath
                            ) {
                                return `${key}${from}${ql}${depImportPath}.${dep.hash.slice(0, hashShort)}.js${qr}${end || ''}`
                            }
                            return s
                        })
                        mod.hash = getHash(mod.jsContent)
                        mod.jsFile = `${mod.jsFile.replace(reHashJs, '')}.${mod.hash.slice(0, hashShort)}.js`
                        Promise.all([
                            writeTextFile(mod.jsFile.replace(reHashJs, '') + '.meta.json', JSON.stringify({
                                sourceFile: mod.url,
                                sourceHash: mod.sourceHash,
                                hash: mod.hash,
                                deps: mod.deps,
                            }, undefined, 4)),
                            writeTextFile(mod.jsFile, mod.jsContent),
                            mod.jsSourceMap !== '' ? writeTextFile(mod.jsFile + '.map', mod.jsSourceMap) : Promise.resolve()
                        ])
                    }
                    callback(mod)
                    tracing.add(mod.id)
                    log.debug('update dependency:', depPath, '->', mod.url)
                    this._updateDependency(mod.url, mod.hash, callback, tracing)
                }
            })
        })
    }

    private _rewriteImportPath(mod: Module, importPath: string, async?: boolean): string {
        const { importMap } = this.config
        let rewrittenPath: string
        if (importPath in importMap.imports) {
            importPath = importMap.imports[importPath]
        }
        if (reHttp.test(importPath)) {
            if (mod.isRemote) {
                rewrittenPath = relativePath(
                    path.dirname(mod.url.replace(reHttp, '/-/').replace(/:(\d+)/, '/$1')),
                    renameImportUrl(importPath)
                )
            } else {
                rewrittenPath = relativePath(
                    path.dirname(mod.url),
                    renameImportUrl(importPath)
                )
            }
        } else {
            if (mod.isRemote) {
                const modUrl = new URL(mod.url)
                let pathname = importPath
                if (!pathname.startsWith('/')) {
                    pathname = path.join(path.dirname(modUrl.pathname), importPath)
                }
                const importUrl = new URL(modUrl.protocol + '//' + modUrl.host + pathname)
                rewrittenPath = relativePath(
                    path.dirname(mod.sourceFilePath),
                    renameImportUrl(importUrl.toString())
                )
            } else {
                rewrittenPath = importPath.replace(reModuleExt, '') + '.' + 'x'.repeat(hashShort)
            }
        }
        if (reHttp.test(importPath)) {
            mod.deps.push({ url: importPath, hash: '', async })
        } else {
            if (mod.isRemote) {
                const sourceUrl = new URL(mod.url)
                let pathname = importPath
                if (!pathname.startsWith('/')) {
                    pathname = path.join(path.dirname(sourceUrl.pathname), importPath)
                }
                mod.deps.push({ url: sourceUrl.protocol + '//' + sourceUrl.host + pathname, hash: '', async })
            } else {
                mod.deps.push({ url: path.join(path.dirname(mod.url), importPath), hash: '', async })
            }
        }

        if (reHttp.test(rewrittenPath)) {
            return rewrittenPath
        }

        if (!rewrittenPath.startsWith('.') && !rewrittenPath.startsWith('/')) {
            rewrittenPath = '/' + rewrittenPath
        }
        return rewrittenPath.replace(reModuleExt, '') + '.js'
    }

    private async _renderPage(loc: { pathname: string, search?: string }) {
        const start = performance.now()
        const [url, pageModuleTree] = this.#routing.createRouter(loc)
        const key = [url.pathname, url.query.toString()].filter(Boolean).join('?')
        if (url.pagePath !== '') {
            if (this.#rendered.has(url.pagePath)) {
                const cache = this.#rendered.get(url.pagePath)!
                if (cache.has(key)) {
                    return cache.get(key)!
                }
            } else {
                this.#rendered.set(url.pagePath, new Map())
            }
        }
        const ret: RenderResult = { url, status: url.pagePath === '' ? 404 : 200, head: [], body: '<main></main>', data: null }
        Object.assign(window, {
            location: {
                protocol: 'http:',
                host: 'localhost',
                hostname: 'localhost',
                port: '',
                href: 'http://localhost' + url.pathname + url.query.toString(),
                origin: 'http://localhost',
                pathname: url.pathname,
                search: url.query.toString(),
                hash: '',
                reload() { },
                replace() { },
                toString() { return this.href },
            }
        })
        if (ret.status === 404) {
            if (this.isDev) {
                log.warn(`page '${url.pathname}' not found`)
            }
            return this._render404Page(url)
        }
        try {
            const appModule = this.#modules.get('/app.js')
            const { default: App } = appModule ? await import('file://' + appModule.jsFile) : {} as any
            const pageComponentTree: { id: string, Component?: any }[] = pageModuleTree.map(({ id }) => ({ id }))
            const imports = pageModuleTree.map(async ({ id }) => {
                const mod = this.#modules.get(id)!
                const { default: C } = await import('file://' + mod.jsFile)
                const pc = pageComponentTree.find(pc => pc.id === mod.id)
                if (pc) {
                    pc.Component = C
                }
            })
            await Promise.all(imports)
            const [html, data] = await this.#renderer.renderPage(url, App, undefined, pageComponentTree)
            const head = await this.#renderer.renderHead([
                appModule ? this._lookupAsyncDeps(appModule.id).filter(({ url }) => reStyleModuleExt.test(url)) : [],
                ...pageModuleTree.map(({ id }) => this._lookupAsyncDeps(id).filter(({ url }) => reStyleModuleExt.test(url)))
            ].flat())
            ret.head = head
            ret.body = `<main>${html}</main>`
            ret.data = data
            this.#rendered.get(url.pagePath)!.set(key, ret)
            if (this.isDev) {
                log.debug(`render '${url.pathname}' in ${Math.round(performance.now() - start)}ms`)
            }
        } catch (err) {
            ret.status = 500
            ret.head = ['<title>Error 500 - Aleph.js</title>']
            ret.body = `<main><pre>${err.stack}</pre></main>`
            log.error(err)
        }
        return ret
    }

    private async _render404Page(url: RouterURL = { locale: this.config.defaultLocale, pagePath: '', pathname: '/', params: {}, query: new URLSearchParams() }) {
        const ret: RenderResult = { url, status: 404, head: [], body: '<main></main>', data: null }
        try {
            const e404Module = this.#modules.get('/404.js')
            const { default: E404 } = e404Module ? await import('file://' + e404Module.jsFile) : {} as any
            const [html, data] = await this.#renderer.renderPage(url, undefined, E404, [])
            const head = await this.#renderer.renderHead([
                e404Module ? this._lookupAsyncDeps(e404Module.id).filter(({ url }) => reStyleModuleExt.test(url)) : []
            ].flat())
            ret.head = head
            ret.body = `<main>${html}</main>`
            ret.data = data
        } catch (err) {
            ret.status = 500
            ret.head = ['<title>Error 500 - Aleph.js</title>']
            ret.body = `<main><pre>${err.stack}</pre></main>`
            log.error(err)
        }
        return ret
    }

    private _lookupAsyncDeps(moduleID: string, __deps: { url: string, hash: string, async?: boolean }[] = [], __tracing: Set<string> = new Set()) {
        const mod = this.getModule(moduleID)
        if (!mod) {
            return __deps
        }
        if (__tracing.has(moduleID)) {
            return __deps
        }
        __tracing.add(moduleID)
        __deps.push(...mod.deps.filter(({ url, async }) => !!async && __deps.findIndex(i => i.url === url) === -1))
        mod.deps.forEach(({ url }) => {
            if (reModuleExt.test(url) && !reHttp.test(url)) {
                this._lookupAsyncDeps(url.replace(reModuleExt, '.js'), __deps, __tracing)
            }
        })
        return __deps
    }
}

export function injectHmr({ id, sourceFilePath, jsContent }: Module): string {
    let hmrImportPath = path.relative(
        path.dirname(sourceFilePath),
        '/-/deno.land/x/aleph/hmr.js'
    )
    if (!hmrImportPath.startsWith('.') && !hmrImportPath.startsWith('/')) {
        hmrImportPath = './' + hmrImportPath
    }

    const text = [
        `import { createHotContext, RefreshRuntime, performReactRefresh } from ${JSON.stringify(hmrImportPath)};`,
        `import.meta.hot = createHotContext(${JSON.stringify(id)});`
    ]
    const reactRefresh = id.endsWith('.js') || id.endsWith('.md') || id.endsWith('.mdx')
    if (reactRefresh) {
        text.push('')
        text.push(
            `const prevRefreshReg = window.$RefreshReg$;`,
            `const prevRefreshSig = window.$RefreshSig$;`,
            `Object.assign(window, {`,
            `    $RefreshReg$: (type, id) => RefreshRuntime.register(type, ${JSON.stringify(id)} + " " + id),`,
            `    $RefreshSig$: RefreshRuntime.createSignatureFunctionForTransform`,
            `});`,
        )
    }
    text.push('')
    text.push(jsContent)
    text.push('')
    if (reactRefresh) {
        text.push(
            'window.$RefreshReg$ = prevRefreshReg;',
            'window.$RefreshSig$ = prevRefreshSig;',
            'import.meta.hot.accept(performReactRefresh);'
        )
    } else {
        text.push('import.meta.hot.accept();')
    }
    return text.join('\n')
}

function relativePath(from: string, to: string): string {
    let r = path.relative(from, to)
    if (!r.startsWith('.') && !r.startsWith('/')) {
        r = './' + r
    }
    return r
}

function renameImportUrl(importUrl: string): string {
    const isRemote = reHttp.test(importUrl)
    const url = new URL(isRemote ? importUrl : 'file://' + importUrl)
    const ext = path.extname(path.basename(url.pathname)) || '.js'
    let pathname = util.trimSuffix(url.pathname, ext)
    let search = Array.from(url.searchParams.entries()).map(([key, value]) => value ? `${key}=${value}` : key)
    if (search.length > 0) {
        pathname += '@' + search.join(',')
    }
    if (isRemote) {
        return '/-/' + url.hostname + (url.port ? '/' + url.port : '') + pathname + ext
    }
    return pathname + ext
}

function getHash(content: string, checkVersion = false) {
    const sha1 = new Sha1()
    sha1.update(content)
    if (checkVersion) {
        sha1.update(version)
    }
    return sha1.hex()
}

function colorfulBytesString(bytes: number) {
    let cf = colors.dim
    if (bytes > 10 * MB) {
        cf = colors.red
    } else if (bytes > MB) {
        cf = colors.yellow
    }
    return cf(util.bytesString(bytes))
}

async function writeTextFile(filepath: string, content: string) {
    const dir = path.dirname(filepath)
    await ensureDir(dir)
    await Deno.writeTextFile(filepath, content)
}
