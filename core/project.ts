import { Request } from '../api.ts'
import type { AcceptedPlugin, ECMA, ServerRequest } from '../deps.ts'
import {
    CleanCSS, colors, ensureDir, less, marked, minify,
    path, postcss, readerFromStreamReader, safeLoadFront, Sha256, walk
} from '../deps.ts'
import { EventEmitter } from '../events.ts'
import { getPagePath, RouteModule, Routing } from '../routing.ts'
import { initSWC, SWCOptions, transpileSync } from '../swc/mod.ts'
import type { APIHandler, Config, RouterURL } from '../types.ts'
import util, {
    hashShort, reFullVersion, reHashJs, reHashResolve, reHttp, reLocaleID,
    reMDExt, reModuleExt, reStyleModuleExt
} from '../util.ts'
import { version } from '../version.ts'
import log from './log.ts'
import type { DependencyDescriptor, ImportMap, Module, RenderResult } from './types.ts'
import {
    cleanupCompilation, colorfulBytesString, createHtml, ensureTextFile, existsDirSync, existsFileSync,
    fixImportMap, getAlephModuleLocalUrlPreifx, getHash, getRelativePath, moduleFromURL
} from './util.ts'

/**
 * A Project to manage the Aleph.js appliaction.
 * core functions include:
 * - manage deps
 * - compile & bundle
 * - apply plugins
 * - map page/API routes
 * - watch file changes
 * - call APIs
 * - SSR/SSG
 */
export class Project {
    readonly appRoot: string
    readonly mode: 'development' | 'production'
    readonly config: Readonly<Required<Config>>
    readonly importMap: Readonly<{ imports: ImportMap, scopes: Record<string, ImportMap> }>
    readonly ready: Promise<void>

    #modules: Map<string, Module> = new Map()
    #pageRouting: Routing = new Routing()
    #apiRouting: Routing = new Routing()
    #fsWatchListeners: Array<EventEmitter> = []
    #renderer: { renderPage: CallableFunction } = { renderPage: () => void 0 }
    #rendered: Map<string, Map<string, RenderResult>> = new Map()
    #postcssPlugins: Record<string, AcceptedPlugin> = {}
    #cleanCSS = new CleanCSS({ compatibility: '*' /* Internet Explorer 10+ */ })
    #denoCacheDir = ''
    #reload = false

    constructor(appDir: string, mode: 'development' | 'production', reload = false) {
        this.appRoot = path.resolve(appDir)
        this.mode = mode
        this.config = {
            srcDir: existsDirSync(path.join(this.appRoot, '/src/pages')) ? '/src' : '/',
            outputDir: '/dist',
            baseUrl: '/',
            defaultLocale: 'en',
            env: {},
            locales: [],
            ssr: {
                fallback: '_fallback.html'
            },
            buildTarget: 'es5',
            reactUrl: 'https://esm.sh/react@17.0.1',
            reactDomUrl: 'https://esm.sh/react-dom@17.0.1',
            plugins: [],
            postcss: {
                plugins: [
                    'autoprefixer'
                ]
            }
        }
        this.importMap = { imports: {}, scopes: {} }
        this.ready = (async () => {
            log.info(colors.bold(`Aleph.js v${version}`))
            log.info(colors.bold('- Global'))
            const t = performance.now()
            await initSWC()
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
        return path.join(this.appRoot, '.aleph', this.mode)
    }

    isHMRable(moduleID: string) {
        if (reStyleModuleExt.test(moduleID)) {
            return true
        }
        if (reMDExt.test(moduleID)) {
            return moduleID.startsWith('/pages/')
        }
        if (reModuleExt.test(moduleID)) {
            return moduleID === '/404.js' ||
                moduleID === '/app.js' ||
                moduleID.startsWith('/pages/') ||
                moduleID.startsWith('/components/')
        }
        const plugin = this.config.plugins.find(p => p.test.test(moduleID))
        if (plugin?.acceptHMR) {
            return true
        }
        return false
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
            return true
        }
        return ssr
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
        if (!this.#modules.has(modId) && modId.endsWith('.js')) {
            modId = util.trimSuffix(modId, '.js')
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

    async callAPI(req: ServerRequest, loc: { pathname: string, search?: string }): Promise<APIHandler | null> {
        const [url] = this.#apiRouting.createRouter({ ...loc, pathname: decodeURI(loc.pathname) })
        if (url.pagePath != '') {
            const moduleID = url.pagePath + '.js'
            if (this.#modules.has(moduleID)) {
                try {
                    const { default: handle } = await import('file://' + this.#modules.get(moduleID)!.jsFile)
                    if (util.isFunction(handle)) {
                        await handle(new Request(req, url.pathname, url.params, url.query))
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

    async getSSRData(loc: { pathname: string, search?: string }): Promise<[number, any]> {
        if (!this.isSSRable(loc.pathname)) {
            return [404, null]
        }

        const { status, data } = await this._renderPage(loc)
        return [status, data]
    }

    async getPageHtml(loc: { pathname: string, search?: string }): Promise<[number, string, Record<string, string> | null]> {
        if (!this.isSSRable(loc.pathname)) {
            const [url] = this.#pageRouting.createRouter(loc)
            return [url.pagePath === '' ? 404 : 200, await this.getSPAIndexHtml(), null]
        }

        const { baseUrl } = this.config
        const mainModule = this.#modules.get('/main.js')!
        const { url, status, head, scripts, body, data } = await this._renderPage(loc)
        const html = createHtml({
            lang: url.locale,
            head: head,
            scripts: [
                data ? { type: 'application/json', innerText: JSON.stringify(data), id: 'ssr-data' } : '',
                { src: util.cleanPath(`${baseUrl}/_aleph/main.${mainModule.hash.slice(0, hashShort)}.js`), type: 'module' },
                ...this._getPreloadScripts(),
                ...scripts
            ],
            body,
            minify: !this.isDev
        })
        return [status, html, data]
    }

    async getSPAIndexHtml() {
        const { baseUrl, defaultLocale } = this.config
        const mainModule = this.#modules.get('/main.js')!
        const customLoading = await this._renderLoadingPage()
        const html = createHtml({
            lang: defaultLocale,
            scripts: [
                { src: util.cleanPath(`${baseUrl}/_aleph/main.${mainModule.hash.slice(0, hashShort)}.js`), type: 'module' },
                { src: util.cleanPath(`${baseUrl}/_aleph/-/deno.land/x/aleph/nomodule.js${this.isDev ? '?dev' : ''}`), nomodule: true },
                ...this._getPreloadScripts()
            ],
            head: customLoading?.head || [],
            body: `<main>${customLoading?.body || ''}</main>`,
            minify: !this.isDev
        })
        return html
    }

    /** build the application to a static site(SSG) */
    async build() {
        const start = performance.now()
        const outputDir = path.join(this.srcDir, this.config.outputDir)
        const distDir = path.join(outputDir, '_aleph')

        // wait for project ready
        await this.ready

        // clean old build
        if (existsDirSync(outputDir)) {
            await Deno.remove(outputDir, { recursive: true })
        }

        // ensure output dirs
        await ensureDir(outputDir)
        await ensureDir(distDir)

        // ssg, bunding & optimizing
        await this._ssg()
        await this._bundle()
        await this._optimize()

        // copy public assets
        const publicDir = path.join(this.appRoot, 'public')
        if (existsDirSync(publicDir)) {
            let n = 0
            for await (const { path: p } of walk(publicDir, { includeDirs: false, skip: [/(^|\/)\.DS_Store$/] })) {
                const rp = util.trimPrefix(p, publicDir)
                const fp = path.join(outputDir, rp)
                const fi = await Deno.lstat(p)
                await ensureDir(path.dirname(fp))
                await Deno.copyFile(p, fp)
                if (n === 0) {
                    log.info(colors.bold('- Public Assets'))
                }
                log.info('  ✹', rp.split('\\').join('/'), colors.dim('•'), colorfulBytesString(fi.size))
                n++
            }
        }

        log.info(`Done in ${Math.round(performance.now() - start)}ms`)
    }

    private _getPreloadScripts() {
        const { baseUrl } = this.config
        const amlUrlPreifx = getAlephModuleLocalUrlPreifx()
        const scripts = [
            `/-/${amlUrlPreifx}/aleph.js`,
            `/-/${amlUrlPreifx}/bootstrap.js`,
            `/-/${amlUrlPreifx}/context.js`,
            `/-/${amlUrlPreifx}/error.js`,
            `/-/${amlUrlPreifx}/events.js`,
            `/-/${amlUrlPreifx}/routing.js`,
            `/-/${amlUrlPreifx}/util.js`
        ]
        return scripts.map(src => ({ src: util.cleanPath(`${baseUrl}/_aleph/${src}`), type: 'module', preload: true }))
    }

    /** load config from `aleph.config.(json|mjs|js|ts)` */
    private async _loadConfig() {
        const importMapFile = path.join(this.appRoot, 'import_map.json')
        if (existsFileSync(importMapFile)) {
            const importMap = JSON.parse(await Deno.readTextFile(importMapFile))
            const imports: ImportMap = fixImportMap(importMap.imports)
            const scopes: Record<string, ImportMap> = {}
            if (util.isPlainObject(importMap.scopes)) {
                Object.entries(importMap.scopes).forEach(([key, imports]) => {
                    scopes[key] = fixImportMap(imports)
                })
            }
            Object.assign(this.importMap, { imports, scopes })
        }

        const p = Deno.run({
            cmd: ['deno', 'info'],
            stdout: 'piped',
            stderr: 'null'
        })
        this.#denoCacheDir = (new TextDecoder).decode(await p.output()).split('"')[1]
        p.close()
        if (!existsDirSync(this.#denoCacheDir)) {
            throw new Error("invalid deno cache dir")
        }

        const config: Record<string, any> = {}
        for (const name of Array.from(['aleph.config', 'config']).map(name => ['ts', 'js', 'mjs', 'json'].map(ext => `${name}.${ext}`)).flat()) {
            const p = path.join(this.appRoot, name)
            if (existsFileSync(p)) {
                log.info('  ✓', name)
                if (name.endsWith('.json')) {
                    const conf = JSON.parse(await Deno.readTextFile(p))
                    if (util.isPlainObject(conf)) {
                        Object.assign(config, conf)
                    }
                } else {
                    let { default: conf } = await import('file://' + p)
                    if (util.isFunction(conf)) {
                        conf = await conf()
                    }
                    if (util.isPlainObject(conf)) {
                        Object.assign(config, conf)
                    }
                }
                break
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
            env,
            plugins,
            postcss,
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
        if (/^es(20\d{2}|5)$/i.test(buildTarget)) {
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
        if (util.isNEArray(plugins)) {
            Object.assign(this.config, { plugins })
        }
        if (util.isPlainObject(postcss) && util.isArray(postcss.plugins)) {
            Object.assign(this.config, { postcss })
        } else if (existsFileSync(path.join(this.appRoot, 'postcss.config.json'))) {
            const text = await Deno.readTextFile(path.join(this.appRoot, 'postcss.config.json'))
            try {
                const postcss = JSON.parse(text)
                if (util.isPlainObject(postcss) && util.isArray(postcss.plugins)) {
                    Object.assign(this.config, { postcss })
                }
            } catch (e) {
                log.warn('bad postcss.config.json', e.message)
            }
        }

        // update import map
        const { __ALEPH_DEV_PORT: devPort } = globalThis as any
        if (devPort) {
            const imports = {
                'https://deno.land/x/aleph/': [`http://localhost:${devPort}/`],
                [`https://deno.land/x/aleph@v${version}/`]: [`http://localhost:${devPort}/`],
                'aleph': [`http://localhost:${devPort}/mod.ts`],
                'aleph/': [`http://localhost:${devPort}/`],
            }
            Object.assign(this.importMap, { imports: Object.assign({}, this.importMap.imports, imports) })
        }
        Object.assign(this.importMap, {
            imports: Object.assign({}, {
                'react': [this.config.reactUrl],
                'react-dom': [this.config.reactDomUrl],
            }, this.importMap.imports)
        })

        // update routing
        this.#pageRouting = new Routing([], this.config.baseUrl, this.config.defaultLocale, this.config.locales)
    }

    /** initialize project */
    private async _init(reload: boolean) {
        const walkOptions = { includeDirs: false, exts: ['.js', '.ts', '.mjs'], skip: [/^\./, /\.d\.ts$/i, /\.(test|spec|e2e)\.m?(j|t)sx?$/i] }
        const apiDir = path.join(this.srcDir, 'api')
        const pagesDir = path.join(this.srcDir, 'pages')

        if (!(existsDirSync(pagesDir))) {
            log.fatal(`'pages' directory not found.`)
        }

        if (reload) {
            this.#reload = true
            if (existsDirSync(this.buildDir)) {
                await Deno.remove(this.buildDir, { recursive: true })
            }
            await ensureDir(this.buildDir)
        }

        // import postcss plugins
        await Promise.all(this.config.postcss.plugins.map(async p => {
            let name: string
            if (typeof p === 'string') {
                name = p
            } else {
                name = p.name
            }
            const { default: Plugin } = await import(`https://esm.sh/${name}?external=postcss@8.1.4&no-check`)
            this.#postcssPlugins[name] = Plugin
        }))

        // inject virtual browser gloabl objects
        Object.assign(globalThis, {
            navigator: {
                connection: {
                    downlink: 1.5,
                    effectiveType: "3g",
                    onchange: null,
                    rtt: 300,
                    saveData: false,
                },
                cookieEnabled: false,
                deviceMemory: 0,
                hardwareConcurrency: 0,
                language: this.config.defaultLocale,
                maxTouchPoints: 0,
                onLine: true,
                userAgent: `Deno/${Deno.version.deno}`,
                vendor: "Deno Land",
            },
            location: {
                protocol: 'http:',
                host: 'localhost',
                hostname: 'localhost',
                port: '',
                href: 'https://localhost/',
                origin: 'https://localhost',
                pathname: '/',
                search: '',
                hash: '',
                reload() { },
                replace() { },
                toString() { return this.href },
            },
            innerWidth: 1920,
            innerHeight: 1080,
            devicePixelRatio: 1,
            $RefreshReg$: () => { },
            $RefreshSig$: () => (type: any) => type,
        })

        // inject env variables
        Object.entries({
            ...this.config.env,
            __version: version,
            __buildMode: this.mode,
        }).forEach(([key, value]) => Deno.env.set(key, value))

        // change current work dir to appDoot
        Deno.chdir(this.appRoot)

        // craete api routing
        if (existsDirSync(apiDir)) {
            for await (const { path: p } of walk(apiDir, walkOptions)) {
                const mod = moduleFromURL('/api' + util.trimPrefix(p, apiDir).split('\\').join('/'))
                mod.hash = getHash(await Deno.readFile(p))
                this.#apiRouting.update(this._getRouteModule(mod))
            }
        }

        // check custom components
        for await (const { path: p, } of walk(this.srcDir, { ...walkOptions, maxDepth: 1, exts: [...walkOptions.exts, '.jsx', '.tsx'] })) {
            const name = path.basename(p)
            let isCustom = true
            switch (name.replace(reModuleExt, '')) {
                case 'app':
                    log.info('  ✓', 'Custom App')
                    break
                case '404':
                    log.info('  ✓', 'Custom 404 Page')
                    break
                case 'loading':
                    log.info('  ✓', 'Custom Loading Page')
                    break
                default:
                    isCustom = false
                    break
            }
            if (isCustom) {
                await this._compile('/' + name)
            }
        }

        // create page routing
        for await (const { path: p } of walk(pagesDir, { ...walkOptions, exts: [...walkOptions.exts, '.jsx', '.tsx', '.md'] })) {
            const rp = util.trimPrefix(p, pagesDir).split('\\').join('/')
            const mod = await this._compile('/pages' + rp)
            this.#pageRouting.update(this._getRouteModule(mod))
        }

        // pre-compile some modules
        const { __ALEPH_DEV_PORT: devPort } = globalThis as any
        const precompileMods = [
            'nomodule.ts',
            'renderer.ts'
        ]
        if (this.isDev) {
            precompileMods.push('hmr.ts')
        }
        for (const mod of precompileMods) {
            if (devPort) {
                await this._compile(`http://localhost:${devPort}/${mod}`)
            } else {
                await this._compile(`https://deno.land/x/aleph@v${version}/${mod}`)
            }
        }
        await this._createMainModule()

        // reload end
        if (reload) {
            this.#reload = false
        }

        // loading renderer
        const amlUrlPreifx = getAlephModuleLocalUrlPreifx()
        const { renderPage } = await import('file://' + this.#modules.get(`//${amlUrlPreifx}/renderer.js`)!.jsFile)
        this.#renderer = { renderPage }

        if (this.isDev) {
            if (this.#apiRouting.paths.length > 0) {
                log.info(colors.bold('- APIs'))
            }
            for (const path of this.#apiRouting.paths) {
                log.info('  λ', path)
            }
            log.info(colors.bold('- Pages'))
            for (const path of this.#pageRouting.paths) {
                const isIndex = path == '/'
                log.info('  ○', path, isIndex ? colors.dim('(index)') : '')
            }
        }

        if (this.isDev) {
            this._watch()
        }
    }

    /** watch file changes, re-compile modules and send HMR signal. */
    private async _watch() {
        const w = Deno.watchFs(this.srcDir, { recursive: true })
        log.info('Start watching code changes...')
        for await (const event of w) {
            for (const p of event.paths) {
                const path = util.cleanPath(util.trimPrefix(p, this.srcDir))
                // handle `api` dir remove directly
                const validated = (() => {
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
                    if (path.startsWith('/pages/') && (reModuleExt.test(path) || reMDExt.test(path))) {
                        return true
                    }
                    let isDep = false
                    for (const { deps } of this.#modules.values()) {
                        if (deps.findIndex(dep => dep.url === path) > -1) {
                            isDep = true
                            break
                        }
                    }
                    if (isDep) {
                        return true
                    }
                    return this.config.plugins.findIndex(p => p.test.test(path)) > -1
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
                            if (moduleID.startsWith('/api/')) {
                                let mod: Module
                                if (this.#modules.has(moduleID)) {
                                    mod = this.#modules.get(moduleID)!
                                } else {
                                    mod = moduleFromURL(moduleID)
                                }
                                Deno.readFile(p).then(content => {
                                    mod.hash = getHash(content)
                                    this.#apiRouting.update(this._getRouteModule(mod))
                                })
                            } else {
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
                                        this.#pageRouting.update(this._getRouteModule(mod))
                                    }
                                    if (shouldUpdateMainModule) {
                                        this._createMainModule()
                                    }
                                    this._updateHash(path, mod.hash, ({ id, hash }) => {
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
                            }
                        } else if (this.#modules.has(moduleID)) {
                            if (moduleID === '/app.js') {
                                this.#rendered.clear()
                            } else if (moduleID.startsWith('/pages/')) {
                                this.#rendered.delete(getPagePath(moduleID))
                                this.#pageRouting.removeRoute(moduleID)
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

    /** returns the route module by given module id and hash. */
    private _getRouteModule({ id, hash }: Module): RouteModule {
        const deps = this._lookupDeps(id).filter(({ isData }) => !!isData)
        return { id, hash, deps: deps.length > 0 ? deps : undefined }
    }

    /** create re-compiled main module. */
    private async _createMainModule(): Promise<Module> {
        const { baseUrl, defaultLocale } = this.config
        const config: Record<string, any> = {
            baseUrl,
            defaultLocale,
            locales: [],
            routes: this.#pageRouting.routes,
            preloadModules: ['/404.js', '/app.js'].filter(id => this.#modules.has(id)).map(id => {
                return this._getRouteModule(this.#modules.get(id)!)
            }),
            renderMode: this.config.ssr ? 'ssr' : 'spa'
        }

        const sourceCode = [
            this.isDev && `import "https://deno.land/x/aleph/hmr.ts"`,
            `import bootstrap from "https://deno.land/x/aleph/bootstrap.ts"`,
            `bootstrap(${JSON.stringify(config, undefined, this.isDev ? 4 : undefined)})`
        ].filter(Boolean).join('\n')
        const module = await this._compile("/main.ts", { sourceCode })
        await cleanupCompilation(module.jsFile)
        await ensureTextFile(module.jsFile, module.jsContent)
        this.#modules.set(module.id, module)

        return module
    }

    /** preprocess a style with postcss pluings */
    private async _preprocessStyle(sourceCode: string, isLess: boolean) {
        let css: string = sourceCode
        if (isLess) {
            try {
                const output = await less.render(sourceCode || '/* empty content */')
                css = output.css
            } catch (error) {
                throw new Error(`less: ${error}`);
            }
        }
        const plugins = this.config.postcss.plugins.map(p => {
            if (typeof p === 'string') {
                return this.#postcssPlugins[p]
            } else {
                const Plugin = this.#postcssPlugins[p.name] as Function
                return Plugin(p.options)
            }
        })
        css = (await postcss(plugins).process(css).async()).content
        if (this.isDev) {
            css = css.trim()
        } else {
            const output = this.#cleanCSS.minify(css)
            css = output.styles
        }
        return css
    }

    /** download and compile a moudle by given url, then cache on the disk. */
    private async _compile(url: string, options?: { sourceCode?: string, loader?: string, forceCompile?: boolean, bundleMode?: boolean, bundleLocalPaths?: string[] }): Promise<Module> {
        const mod = moduleFromURL(url)
        const bundleMode = !!options?.bundleMode

        if (this.#modules.has(mod.id) && !options?.forceCompile && !options?.sourceCode && !bundleMode) {
            return this.#modules.get(mod.id)!
        }

        const name = path.basename(mod.localUrl).replace(reModuleExt, '')
        const saveDir = path.join(this.buildDir, path.dirname(mod.localUrl))
        const metaFile = path.join(saveDir, `${name}.meta.json`)

        if (!bundleMode && existsFileSync(metaFile)) {
            const { sourceHash, hash, deps } = JSON.parse(await Deno.readTextFile(metaFile))
            const jsFile = path.join(saveDir, name + (mod.isRemote ? '' : '.' + hash.slice(0, hashShort))) + '.js'
            if (util.isNEString(sourceHash) && util.isNEString(hash) && util.isArray(deps) && existsFileSync(jsFile)) {
                try {
                    mod.sourceHash = sourceHash
                    mod.hash = hash
                    mod.deps = deps
                    mod.jsFile = jsFile
                    mod.jsContent = await Deno.readTextFile(jsFile)
                    if (existsFileSync(jsFile + '.map')) {
                        mod.jsSourceMap = await Deno.readTextFile(jsFile + '.map')
                    }
                } catch (e) { }
            }
        }

        let sourceContent = new Uint8Array()
        let shouldCompile = false
        let fsync = false

        if (options?.sourceCode) {
            sourceContent = (new TextEncoder).encode(options.sourceCode)
            const sourceHash = getHash(sourceContent)
            if (mod.sourceHash === '' || mod.sourceHash !== sourceHash) {
                mod.sourceHash = sourceHash
                shouldCompile = true
            }
        } else if (mod.isRemote) {
            let dlUrl = url
            if (dlUrl.startsWith('https://esm.sh/')) {
                const u = new URL(dlUrl)
                if (this.isDev && !u.searchParams.has('dev')) {
                    u.searchParams.set('dev', '')
                }
                dlUrl = u.toString().replace(/=(&|$)/, '$1')
            }
            if (/^https?:\/\/localhost(:\d+)?\//.test(dlUrl)) {
                try {
                    const resp = await fetch(dlUrl)
                    if (resp.status != 200) {
                        throw new Error(`${resp.status} - ${resp.statusText}`)
                    }
                    sourceContent = await Deno.readAll(readerFromStreamReader(resp.body!.getReader()))
                    const sourceHash = getHash(sourceContent)
                    if (mod.sourceHash === '' || mod.sourceHash !== sourceHash) {
                        mod.sourceHash = sourceHash
                        shouldCompile = true
                    }
                } catch (err) {
                    throw new Error(`Download ${url}: ${err.message}`)
                }
            } else if (mod.sourceHash === '' || !reFullVersion.test(dlUrl)) {
                try {
                    sourceContent = await this._loadDependency(dlUrl)
                    const sourceHash = getHash(sourceContent)
                    if (mod.sourceHash === '' || mod.sourceHash !== sourceHash) {
                        mod.sourceHash = sourceHash
                        shouldCompile = true
                    }
                } catch (err) {
                    log.error(`dependency '${url}' not found`)
                    mod.error = err
                    return mod
                }
            }
        } else {
            const filepath = path.join(this.srcDir, url)
            try {
                sourceContent = await Deno.readFile(filepath)
                const sourceHash = getHash(sourceContent)
                if (mod.sourceHash === '' || mod.sourceHash !== sourceHash) {
                    mod.sourceHash = sourceHash
                    shouldCompile = true
                }
            } catch (err) {
                if (err instanceof Deno.errors.NotFound) {
                    log.error(`module '${filepath}' not found`)
                    mod.error = err
                    return mod
                }
                throw err
            }
        }

        // compile source code
        if (shouldCompile) {
            const t = performance.now()
            let sourceCode = (new TextDecoder).decode(sourceContent)
            let loader = mod.loader
            if (!options?.loader) {
                for (const plugin of this.config.plugins) {
                    if (plugin.test.test(url) && util.isFunction(plugin.transform)) {
                        const { code, loader: pluginLodaer = 'js' } = await plugin.transform(sourceContent, url)
                        sourceCode = code
                        loader = pluginLodaer
                        mod.loader = pluginLodaer
                        break
                    }
                }
            } else {
                loader = options.loader
            }
            mod.deps = []
            if (loader === 'css') {
                const css = await this._preprocessStyle(sourceCode, mod.id.endsWith('.less'))
                return await this._compile(url, {
                    ...options,
                    loader: 'js',
                    sourceCode: (`
                        import { applyCSS } from "https://deno.land/x/aleph@v${version}/style.ts";\
                        applyCSS(${JSON.stringify(url)}, ${JSON.stringify(this.isDev ? `\n${css}\n` : css)});
                    `).replaceAll(' '.repeat(24), '').trim(),
                })
            } else if (loader === 'markdown') {
                const { __content, ...props } = safeLoadFront(sourceCode)
                const html = marked.parse(__content)
                return await this._compile(url, {
                    ...options,
                    loader: 'js',
                    sourceCode: (`
                        import React, { useEffect, useRef } from ${JSON.stringify(this.config.reactUrl)};
                        import { redirect } from "https://deno.land/x/aleph@v${version}/anchor.ts";
                        export default function MarkdownPage() {
                            const ref = useRef(null);
                            useEffect(() => {
                                const anchors = [];
                                const onClick = e => {
                                    e.preventDefault();
                                    redirect(e.currentTarget.getAttribute("href"));
                                };
                                if (ref.current) {
                                    ref.current.querySelectorAll("a").forEach(a => {
                                        const href = a.getAttribute("href");
                                        if (href && !/^[a-z0-9]+:/i.test(href)) {
                                            a.addEventListener("click", onClick, false);
                                            anchors.push(a);
                                        }
                                    });
                                }
                                return () => anchors.forEach(a => a.removeEventListener("click", onClick));
                            }, []);
                            return React.createElement("div", {
                                className: "markdown-page",
                                ref,
                                dangerouslySetInnerHTML: {__html: ${JSON.stringify(html)}}
                            });
                        }
                        MarkdownPage.meta = ${JSON.stringify(props, undefined, 4)};
                    `).replaceAll(' '.repeat(24), '').trim(),
                })
            } else if (loader === 'js' || loader === 'ts' || loader === 'jsx' || loader === 'tsx') {
                const swcOptions: SWCOptions = {
                    target: 'es2020',
                    sourceType: loader,
                    sourceMap: true,
                }
                const { code, map, deps, inlineStyles } = transpileSync(sourceCode, {
                    url,
                    importMap: this.importMap,
                    reactUrl: this.config.reactUrl,
                    reactDomUrl: this.config.reactDomUrl,
                    swcOptions,
                    isDev: this.isDev,
                    bundleMode,
                    bundleLocalPaths: options?.bundleLocalPaths
                })
                mod.jsContent = code
                mod.jsSourceMap = map!
                await Promise.all(Object.entries(inlineStyles).map(async ([key, style]) => {
                    let type = style.type
                    let tpl = style.quasis.reduce((css, quais, i, a) => {
                        css += quais
                        if (i < a.length - 1) {
                            css += `%%aleph-inline-style-expr-${i}%%`
                        }
                        return css
                    }, '')
                        .replace(/\:\s*%%aleph-inline-style-expr-(\d+)%%/g, (_, id) => `: var(--aleph-inline-style-expr-${id})`)
                        .replace(/%%aleph-inline-style-expr-(\d+)%%/g, (_, id) => `/*%%aleph-inline-style-expr-${id}%%*/`)
                    if (type !== 'css' && type !== 'less') {
                        for (const plugin of this.config.plugins) {
                            if (plugin.test.test(`${key}.${type}`) && util.isFunction(plugin.transform)) {
                                const { code, loader } = await plugin.transform((new TextEncoder).encode(tpl), url)
                                if (loader === 'css') {
                                    tpl = code
                                    type = 'css'
                                }
                                break
                            }
                        }
                    }
                    if (type === 'css' || type === 'less') {
                        tpl = await this._preprocessStyle(tpl, type === 'less')
                        tpl = tpl.replace(
                            /\: var\(--aleph-inline-style-expr-(\d+)\)/g,
                            (_, id) => ': ${' + style.exprs[parseInt(id)] + '}'
                        ).replace(
                            /\/\*%%aleph-inline-style-expr-(\d+)%%\*\//g,
                            (_, id) => '${' + style.exprs[parseInt(id)] + '}'
                        )
                        mod.jsContent = mod.jsContent.replace(`"%%${key}-placeholder%%"`, '`' + tpl + '`')
                    }
                }))
                deps.forEach(({ specifier, isDynamic }) => {
                    const dep: DependencyDescriptor = { url: specifier, hash: '' }
                    if (isDynamic) {
                        dep.isDynamic = true
                    }
                    if (dep.url.startsWith('#useDeno-')) {
                        dep.isData = true
                        dep.hash = util.trimPrefix(dep.url, '#useDeno-')
                    }
                    if (dep.url.startsWith('#inline-style-')) {
                        dep.isStyle = true
                        dep.hash = util.trimPrefix(dep.url, '#inline-style-')
                    }
                    mod.deps.push(dep)
                })
            } else {
                throw new Error(`Unknown loader '${loader}'`)
            }

            log.debug(`compile '${url}' in ${Math.round(performance.now() - t)}ms ${bundleMode ? '(bundle mode)' : ''}`)

            if (!fsync) {
                fsync = true
            }
        }

        if (!bundleMode) {
            this.#modules.set(mod.id, mod)
        }

        // compile deps
        for (const dep of mod.deps.filter(({ url }) => {
            return !url.startsWith('#') && (!bundleMode || (!reHttp.test(url) && !options?.bundleLocalPaths?.includes(url)))
        })) {
            const depMod = await this._compile(dep.url, { bundleMode, bundleLocalPaths: options?.bundleLocalPaths })
            if (depMod.loader === 'css' && !dep.isStyle) {
                dep.isStyle = true
            }
            if (dep.hash === '' || dep.hash !== depMod.hash) {
                dep.hash = depMod.hash
                if (!reHttp.test(dep.url)) {
                    const depImportPath = getRelativePath(
                        path.dirname(url),
                        dep.url.replace(reModuleExt, '')
                    )
                    mod.jsContent = mod.jsContent.replace(reHashResolve, (s, key, spaces, ql, importPath, qr) => {
                        if (importPath.slice(0, - (hashShort + 4)) === depImportPath) {
                            if (bundleMode) {
                                return `${key}${spaces}${ql}${depImportPath}.bundling.js${qr}`
                            } else {
                                return `${key}${spaces}${ql}${depImportPath}.${dep.hash.slice(0, hashShort)}.js${qr}`
                            }
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

        if (!bundleMode) {
            if (fsync) {
                mod.hash = getHash(mod.jsContent)
                mod.jsFile = path.join(saveDir, name + (mod.isRemote ? '' : `.${mod.hash.slice(0, hashShort)}`)) + (bundleMode ? '.bundling' : '') + '.js'
                await cleanupCompilation(mod.jsFile)
                await Promise.all([
                    ensureTextFile(metaFile, JSON.stringify({
                        url,
                        sourceHash: mod.sourceHash,
                        hash: mod.hash,
                        deps: mod.deps,
                    }, undefined, 4)),
                    ensureTextFile(mod.jsFile, mod.jsContent),
                    mod.jsSourceMap ? ensureTextFile(mod.jsFile + '.map', mod.jsSourceMap) : Promise.resolve()
                ])
            }
        } else {
            mod.jsFile = path.join(saveDir, name + '.bundling.js')
            await ensureTextFile(mod.jsFile, mod.jsContent)
        }

        return mod
    }

    /** update module hash since the dependency changed. */
    private _updateHash(depUrl: string, depHash: string, callback: (mod: Module) => void) {
        this.#modules.forEach(mod => {
            for (const dep of mod.deps) {
                if (dep.url === depUrl) {
                    if (dep.hash !== depHash) {
                        dep.hash = depHash
                        if (mod.id === '/main.js') {
                            this._createMainModule()
                        } else {
                            const depImportPath = getRelativePath(
                                path.dirname(mod.url),
                                dep.url.replace(reModuleExt, '')
                            )
                            mod.jsContent = mod.jsContent.replace(reHashResolve, (s, key, spaces, ql, importPath, qr) => {
                                if (importPath.slice(0, - (hashShort + 4)) === depImportPath) {
                                    return `${key}${spaces}${ql}${depImportPath}.${dep.hash.slice(0, hashShort)}.js${qr}`
                                }
                                return s
                            })
                            mod.hash = getHash(mod.jsContent)
                            mod.jsFile = `${mod.jsFile.replace(reHashJs, '')}.${mod.hash.slice(0, hashShort)}.js`
                            cleanupCompilation(mod.jsFile).then(() => {
                                Promise.all([
                                    ensureTextFile(mod.jsFile.replace(reHashJs, '') + '.meta.json', JSON.stringify({
                                        sourceFile: mod.url,
                                        sourceHash: mod.sourceHash,
                                        hash: mod.hash,
                                        deps: mod.deps,
                                    }, undefined, 4)),
                                    ensureTextFile(mod.jsFile, mod.jsContent),
                                    mod.jsSourceMap ? ensureTextFile(mod.jsFile + '.map', mod.jsSourceMap) : Promise.resolve()
                                ])
                            })
                        }
                        callback(mod)
                        log.debug('update dependency:', mod.url, '<-', depUrl)
                        this._updateHash(mod.url, mod.hash, callback)
                    }
                    break
                }
            }
        })
    }

    /** load dependency conentent, use deno builtin cache system */
    private async _loadDependency(url: string): Promise<Uint8Array> {
        const { protocol, hostname, port, pathname, search } = new URL(url)
        const versioned = reFullVersion.test(pathname)
        const dir = path.join(this.#denoCacheDir, 'deps', util.trimSuffix(protocol, ':'), hostname + (port ? '_PORT' + port : ''))
        const filename = path.join(dir, (new Sha256()).update(pathname + search).hex())

        if (versioned && !this.#reload && existsFileSync(filename)) {
            return await Deno.readFile(filename)
        }

        const p = Deno.run({
            cmd: ['deno', 'cache', this.#reload || !versioned ? '--reload' : '', url].filter(Boolean),
            stdout: 'inherit',
            stderr: 'inherit'
        })
        await p.status()
        p.close()

        if (existsFileSync(filename)) {
            return await Deno.readFile(filename)
        } else {
            throw new Error(`not found`)
        }
    }

    /** bundle modules for production. */
    private async _bundle() {
        const refCounter = new Map<string, number>()
        const lookup = (moduleID: string) => {
            if (this.#modules.has(moduleID)) {
                const { deps } = this.#modules.get(moduleID)!
                deps.forEach(({ url }) => {
                    if (!refCounter.has(url)) {
                        refCounter.set(url, 1)
                    } else {
                        refCounter.set(url, refCounter.get(url)! + 1)
                    }
                })
            }
        }

        lookup('/main.js')
        lookup('/app.js')
        lookup('/404.js')
        this.#pageRouting.lookup(routes => routes.forEach(r => lookup(r.module.id)))

        const remoteList: string[] = []
        const localList: string[] = []
        Array.from(refCounter.entries()).forEach(([url, count]) => {
            if (reHttp.test(url)) {
                remoteList.push(url)
            } else if (!url.startsWith('#') && !url.startsWith('/pages/') && count > 1) {
                localList.push(url)
            }
        })

        log.info('- Bundle')
        await this._createBundle('deps', remoteList)
        if (localList.length > 0) {
            await this._createBundle('shared', localList)
        }

        const pageModules: Module[] = []
        this.#pageRouting.lookup(routes => routes.forEach(({ module: { id } }) => {
            const mod = this.getModule(id)
            if (mod) {
                pageModules.push(mod)
            }
        }))
        await Promise.all(pageModules.map(async mod => {
            const { jsFile } = await this._compile(mod.url, { bundleMode: true })
            const bundleFile = util.trimSuffix(jsFile, '.bundling.js') + '.bundle.js'
            const ok = await this._runDenoBundle(jsFile, bundleFile)
            if (!ok) {
                return
            }
        }))
    }

    private async _createBundle(name: string, list: string[]) {
        const header = `
            const __ALEPH = window.__ALEPH || (window.__ALEPH = {
                pack: {},
                import: (url) => {

                },
                export: (specifier, name, expr) => {

                },
                exportFrom: (specifier, url, exports) => {

                }
            });
        `.replaceAll(' '.repeat(12), '').trim()
        const imports = list.map((url, i) => {
            const { id } = moduleFromURL(url)
            const mod = this.getModule(id)!
            if (mod) {
                return [
                    `import * as mod${i} from "${mod.jsFile}"`,
                    `__ALEPH.pack["${url}"] = mod${i}`
                ]
            }
            return []
        }).flat().join('\n')
        const entryFile = path.join(this.buildDir, name + '_entry.js')
        const bundleFile = path.join(this.buildDir, name + '.js')

        if (existsFileSync(bundleFile)) {
            Deno.remove(bundleFile)
        }
        await Deno.writeTextFile(entryFile, header + '\n' + imports)

        // run deno bundle
        const n = await this._runDenoBundle(entryFile, bundleFile)
        if (!n) {
            return
        }

        log.info(`  {} ${name}.js ${colors.dim('• ' + util.bytesString(n))}`)
    }

    private async _runDenoBundle(entryFile: string, bundleFile: string) {
        const p = Deno.run({
            cmd: ['deno', 'bundle', '--no-check', entryFile, bundleFile],
            stdout: 'null',
            stderr: 'piped'
        })
        const data = await p.stderrOutput()
        p.close()
        if (!existsFileSync(bundleFile)) {
            const msg = (new TextDecoder).decode(data).replaceAll('file://', '').replaceAll(this.buildDir, '/aleph.js')
            await Deno.stderr.write((new TextEncoder).encode(msg))
            return 0
        }

        // compile bundle code to `buildTarget`
        const sourceCode = await Deno.readTextFile(bundleFile)
        let { code } = transpileSync(sourceCode, {
            url: '/bundle.js',
            swcOptions: {
                target: this.config.buildTarget
            },
        })

        // minify code
        const ret = await minify(code, {
            compress: true,
            mangle: true,
            ecma: parseInt(util.trimPrefix(this.config.buildTarget, 'es')) as ECMA,
            sourceMap: false
        })
        if (ret.code) {
            code = ret.code
        }

        await Deno.writeTextFile(bundleFile, code)
        return code.length
    }

    /** optimize images for production. */
    private async _optimize() {

    }

    /** render all pages in routing. */
    private async _ssg() {
        const { ssr } = this.config
        const outputDir = path.join(this.srcDir, this.config.outputDir)

        if (ssr) {
            log.info(colors.bold('- Pages (SSG)'))
            const paths = new Set(this.#pageRouting.paths)
            if (typeof ssr === 'object' && ssr.staticPaths) {
                ssr.staticPaths.forEach(path => paths.add(path))
            }
            await Promise.all(Array.from(paths).map(async pathname => {
                if (this.isSSRable(pathname)) {
                    const [status, html, data] = await this.getPageHtml({ pathname })
                    if (status == 200) {
                        const htmlFile = path.join(outputDir, pathname, 'index.html')
                        await ensureTextFile(htmlFile, html)
                        if (data) {
                            const dataFile = path.join(outputDir, '_aleph/data', pathname, 'data.js')
                            await ensureTextFile(dataFile, `export default ` + JSON.stringify(data))
                        }
                        log.info('  ○', pathname, colors.dim('• ' + util.bytesString(html.length)))
                    } else if (status == 404) {
                        log.info('  ○', colors.dim(pathname), colors.red(`Page not found`))
                    } else if (status == 500) {
                        log.info('  ○', colors.dim(pathname), colors.red(`Error 500`))
                    }
                }
            }))
            const fbHtmlFile = path.join(outputDir, util.isPlainObject(ssr) && ssr.fallback ? ssr.fallback : '_fallback.html')
            await ensureTextFile(fbHtmlFile, await this.getSPAIndexHtml())
        } else {
            await ensureTextFile(path.join(outputDir, 'index.html'), await this.getSPAIndexHtml())
        }

        // write 404 page
        const { baseUrl } = this.config
        const { url, head, scripts, body, data } = await this._render404Page()
        const mainModule = this.#modules.get('/main.js')!
        const e404PageHtml = createHtml({
            lang: url.locale,
            head: head,
            scripts: [
                data ? { type: 'application/json', innerText: JSON.stringify(data), id: 'ssr-data' } : '',
                { src: util.cleanPath(`${baseUrl}/_aleph/main.${mainModule.hash.slice(0, hashShort)}.js`), type: 'module' },
                { src: util.cleanPath(`${baseUrl}/_aleph/-/deno.land/x/aleph/nomodule.js${this.isDev ? '?dev' : ''}`), nomodule: true },
                ...this._getPreloadScripts(),
                ...scripts
            ],
            body,
            minify: !this.isDev
        })
        await ensureTextFile(path.join(outputDir, '404.html'), e404PageHtml)
    }

    /** render page base the given location. */
    private async _renderPage(loc: { pathname: string, search?: string }) {
        const start = performance.now()
        const [url, pageModuleTree] = this.#pageRouting.createRouter(loc)
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
        const ret: RenderResult = {
            url,
            status: url.pagePath === '' ? 404 : 200,
            head: [],
            scripts: [],
            body: '<main></main>',
            data: null,
        }
        if (ret.status === 404) {
            if (this.isDev) {
                log.warn(`page '${url.pathname}' not found`)
            }
            return await this._render404Page(url)
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
            const {
                head,
                body,
                data,
                scripts
            } = await this.#renderer.renderPage(
                url,
                App,
                undefined,
                pageComponentTree,
                [
                    appModule ? this._lookupDeps(appModule.id).filter(dep => !!dep.isStyle) : [],
                    ...pageModuleTree.map(({ id }) => this._lookupDeps(id).filter(dep => !!dep.isStyle)).flat()
                ].flat()
            )
            ret.head = head
            ret.scripts = await Promise.all(scripts.map(async (script: Record<string, any>) => {
                if (script.innerText && !this.isDev) {
                    return { ...script, innerText: (await minify(script.innerText)).code }
                }
                return script
            }))
            ret.body = `<main>${body}</main>`
            ret.data = data
            this.#rendered.get(url.pagePath)!.set(key, ret)
            if (this.isDev) {
                log.debug(`render '${url.pathname}' in ${Math.round(performance.now() - start)}ms`)
            }
        } catch (err) {
            ret.status = 500
            ret.head = ['<title>Error 500 - Aleph.js</title>']
            ret.body = `<main><pre>${colors.stripColor(err.stack)}</pre></main>`
            log.error(err)
        }
        return ret
    }

    /** render custom 404 page. */
    private async _render404Page(url: RouterURL = { locale: this.config.defaultLocale, pagePath: '', pathname: '/', params: {}, query: new URLSearchParams() }) {
        const ret: RenderResult = { url, status: 404, head: [], scripts: [], body: '<main></main>', data: null }
        try {
            const e404Module = this.#modules.get('/404.js')
            const { default: E404 } = e404Module ? await import('file://' + e404Module.jsFile) : {} as any
            const {
                head,
                body,
                data,
                scripts
            } = await this.#renderer.renderPage(
                url,
                undefined,
                E404,
                [],
                e404Module ? this._lookupDeps(e404Module.id).filter(dep => !!dep.isStyle) : []
            )
            ret.head = head
            ret.scripts = await Promise.all(scripts.map(async (script: Record<string, any>) => {
                if (script.innerText && !this.isDev) {
                    return { ...script, innerText: (await minify(script.innerText)).code }
                }
                return script
            }))
            ret.body = `<main>${body}</main>`
            ret.data = data
        } catch (err) {
            ret.status = 500
            ret.head = ['<title>Error 500 - Aleph.js</title>']
            ret.body = `<main><pre>${colors.stripColor(err.stack)}</pre></main>`
            log.error(err)
        }
        return ret
    }

    /** render custom loading page for SPA mode. */
    private async _renderLoadingPage() {
        if (this.#modules.has('/loading.js')) {
            const loadingModule = this.#modules.get('/loading.js')!
            const { default: Loading } = await import('file://' + loadingModule.jsFile)
            const url = {
                locale: this.config.defaultLocale,
                pagePath: '',
                pathname: '/',
                params: {},
                query: new URLSearchParams()
            }

            const {
                head,
                body
            } = await this.#renderer.renderPage(
                url,
                undefined,
                undefined,
                [{ id: '/loading.js', Component: Loading }],
                this._lookupDeps(loadingModule.id).filter(dep => !!dep.isStyle)
            )
            return {
                head,
                body: `<main>${body}</main>`
            } as Pick<RenderResult, 'head' | 'body'>
        }
        return null
    }

    private _lookupDeps(moduleID: string, __deps: DependencyDescriptor[] = [], __tracing: Set<string> = new Set()) {
        const mod = this.getModule(moduleID)
        if (!mod) {
            return __deps
        }
        if (__tracing.has(moduleID)) {
            return __deps
        }
        __tracing.add(moduleID)
        __deps.push(...mod.deps.filter(({ url }) => __deps.findIndex(i => i.url === url) === -1))
        mod.deps.forEach(({ url }) => {
            if (reModuleExt.test(url) && !reHttp.test(url)) {
                this._lookupDeps(url.replace(reModuleExt, '.js'), __deps, __tracing)
            }
        })
        return __deps
    }
}
