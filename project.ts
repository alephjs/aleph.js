import { Request } from './api.ts'
import {
    initWasm,
    SWCOptions,
    TransformOptions,
    transpileSync
} from './compiler/mod.ts'
import type { AcceptedPlugin, ServerRequest } from './deps.ts'
import {
    CleanCSS,
    colors,
    ensureDir,
    less,
    marked,
    minify,
    path,
    postcss,

    safeLoadFront,
    Sha1,
    Sha256,
    walk
} from './deps.ts'
import log from './log.ts'
import { getPagePath, RouteModule, Routing } from './routing.ts'
import { EventEmitter } from './shared/events.ts'
import util, {
    hashShort,
    reFullVersion,
    reHashJs,
    reHashResolve,
    reHttp,
    reLocaleID,
    reMDExt,
    reModuleExt,
    reStyleModuleExt
} from './shared/util.ts'
import type {
    APIHandler,
    Config,
    DependencyDescriptor,
    ImportMap,
    Module,
    RouterURL
} from './types.ts'
import {
    cleanupCompilation,
    colorfulBytesString,
    createHtml,
    ensureTextFile,
    existsDirSync,
    existsFileSync,
    fixImportMap,
    fixImportUrl,
    getAlephPkgUrl,
    getRelativePath,
    newModule
} from './util.ts'
import { version } from './version.ts'

interface RenderResult {
    url: RouterURL
    status: number
    head: string[]
    scripts: Record<string, any>[]
    body: string
    data: Record<string, string> | null
}

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

    #denoCacheDir = ''
    #modules: Map<string, Module> = new Map()
    #pageRouting: Routing = new Routing()
    #apiRouting: Routing = new Routing()
    #fsWatchListeners: Array<EventEmitter> = []
    #renderer: { renderPage: CallableFunction } = { renderPage: () => { } }
    #rendered: Map<string, Map<string, RenderResult>> = new Map()
    #postcssPlugins: Record<string, AcceptedPlugin> = {}
    #cleanCSS = new CleanCSS({ compatibility: '*' /* Internet Explorer 10+ */ })
    #swcReady: Promise<void> | null = null
    #postcssReady: Promise<void[]> | null = null
    #reloading = false

    constructor(appDir: string, mode: 'development' | 'production', reload = false) {
        this.appRoot = path.resolve(appDir)
        this.mode = mode
        this.config = {
            framework: 'react',
            srcDir: existsDirSync(path.join(this.appRoot, '/src/pages')) ? '/src' : '/',
            outputDir: '/dist',
            baseUrl: '/',
            defaultLocale: 'en',
            env: {},
            locales: [],
            ssr: {
                fallback: '_fallback_spa.html'
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
        this.ready = this._init(reload)
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

    get outputDir() {
        return path.join(this.appRoot, this.config.outputDir)
    }

    isHMRable(url: string) {
        if (!this.isDev) {
            return false
        }
        if (reStyleModuleExt.test(url)) {
            return true
        }
        if (reMDExt.test(url)) {
            return url.startsWith('/pages/')
        }
        if (reModuleExt.test(url)) {
            return url.startsWith('/pages/') ||
                url.startsWith('/components/') ||
                url.replace(reModuleExt, '') === "/app" ||
                url.replace(reModuleExt, '') === "/404"
        }
        const plugin = this.config.plugins.find(p => p.test.test(url))
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

    getModule(url: string): Module | null {
        if (this.#modules.has(url)) {
            return this.#modules.get(url)!
        }
        return null
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
        const [url, chain] = this.#apiRouting.createRouter({
            ...loc,
            pathname: decodeURI(loc.pathname)
        })
        if (url.pagePath != '') {
            const { url: moduleUrl } = chain[chain.length - 1]
            if (this.#modules.has(moduleUrl)) {
                try {
                    const { default: handle } = await import('file://' + this.#modules.get(moduleUrl)!.jsFile)
                    if (util.isFunction(handle)) {
                        await handle(new Request(req, url.pathname, url.params, url.query))
                    } else {
                        req.respond({
                            status: 500,
                            headers: new Headers({ 'Content-Type': 'application/json; charset=utf-8' }),
                            body: JSON.stringify({ error: { status: 404, message: "handle not found" } })
                        }).catch((err: Error) => log.warn('ServerRequest.respond:', err.message))
                    }
                } catch (err) {
                    req.respond({
                        status: 500,
                        headers: new Headers({ 'Content-Type': 'application/json; charset=utf-8' }),
                        body: JSON.stringify({ error: { status: 500, message: err.message } })
                    }).catch((err: Error) => log.warn('ServerRequest.respond:', err.message))
                    log.error('callAPI:', err)
                }
            }
        } else {
            req.respond({
                status: 404,
                headers: new Headers({ 'Content-Type': 'application/javascript; charset=utf-8' }),
                body: JSON.stringify({ error: { status: 404, message: 'page not found' } })
            }).catch((err: Error) => log.warn('ServerRequest.respond:', err.message))
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

        const { url, status, head, scripts, body, data } = await this._renderPage(loc)
        const html = createHtml({
            lang: url.locale,
            head: head,
            scripts: [
                data ? { type: 'application/json', innerText: JSON.stringify(data), id: 'ssr-data' } : '',
                ...this._getPreloadScripts(),
                ...scripts
            ],
            body,
            minify: !this.isDev
        })
        return [status, html, data]
    }

    async getSPAIndexHtml() {
        const { defaultLocale } = this.config
        const customLoading = await this._renderLoadingPage()
        const html = createHtml({
            lang: defaultLocale,
            scripts: [
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
        const outputDir = this.outputDir
        const distDir = path.join(outputDir, '_aleph')

        // wait for project ready
        await this.ready

        // clean old build
        if (existsDirSync(outputDir)) {
            for await (const entry of Deno.readDir(outputDir)) {
                await Deno.remove(path.join(outputDir, entry.name), { recursive: entry.isDirectory })
            }
        }

        // ensure output dir
        await ensureDir(distDir)

        // ssg, bundle & optimizing
        await this._bundle()
        await this._optimize()
        await this._ssg()

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
                log.info('  ∆', rp.split('\\').join('/'), colors.dim('•'), colorfulBytesString(fi.size))
                n++
            }
        }

        log.info(`Done in ${Math.round(performance.now() - start)}ms`)
    }

    /** inject HMR helper code  */
    injectHmr(url: string, content: string): string {
        const { __ALEPH_DEV_PORT: devPort } = globalThis as any
        const alephModuleLocalUrlPreifx = devPort ? `http_localhost_${devPort}` : `deno.land/x/aleph@v${version}`
        const localUrl = fixImportUrl(url)
        const hmrImportPath = getRelativePath(
            path.dirname(localUrl),
            `/-/${alephModuleLocalUrlPreifx}/hmr.js`
        )
        const lines = [
            `import { createHotContext } from ${JSON.stringify(hmrImportPath)};`,
            `import.meta.hot = createHotContext(${JSON.stringify(url)});`
        ]
        const reactRefresh = this.config.framework === 'react' && (reModuleExt.test(url) || reMDExt.test(url))
        if (reactRefresh) {
            const refreshImportPath = getRelativePath(
                path.dirname(localUrl),
                `/-/${alephModuleLocalUrlPreifx}/framework/react/refresh.js`
            )
            lines.push(`import { RefreshRuntime, performReactRefresh } from ${JSON.stringify(refreshImportPath)};`)
            lines.push('')
            lines.push(
                `const prevRefreshReg = window.$RefreshReg$;`,
                `const prevRefreshSig = window.$RefreshSig$;`,
                `Object.assign(window, {`,
                `    $RefreshReg$: (type, id) => RefreshRuntime.register(type, ${JSON.stringify(url)} + " " + id),`,
                `    $RefreshSig$: RefreshRuntime.createSignatureFunctionForTransform`,
                `});`,
            )
        }
        lines.push('')
        lines.push(content)
        lines.push('')
        if (reactRefresh) {
            lines.push(
                'window.$RefreshReg$ = prevRefreshReg;',
                'window.$RefreshSig$ = prevRefreshSig;',
                'import.meta.hot.accept(performReactRefresh);'
            )
        } else {
            lines.push('import.meta.hot.accept();')
        }
        return lines.join('\n')
    }

    private _getPreloadScripts() {
        const { baseUrl } = this.config
        const mainModule = this.#modules.get('/main.ts')!
        const depsModule = this.#modules.get('/deps.bundling.js')
        const sharedModule = this.#modules.get('/shared.bundling.js')
        const ployfillModule = this.#modules.get('/ployfill.js')

        return [
            ployfillModule ? { src: util.cleanPath(`${baseUrl}/_aleph/ployfill.${ployfillModule.hash.slice(0, hashShort)}.js`) } : {},
            depsModule ? { src: util.cleanPath(`${baseUrl}/_aleph/deps.${depsModule.hash.slice(0, hashShort)}.js`), } : {},
            sharedModule ? { src: util.cleanPath(`${baseUrl}/_aleph/shared.${sharedModule.hash.slice(0, hashShort)}.js`), } : {},
            !this.isDev ? { src: util.cleanPath(`${baseUrl}/_aleph/main.${mainModule.sourceHash.slice(0, hashShort)}.js`), } : {},
            this.isDev ? { src: util.cleanPath(`${baseUrl}/_aleph/main.${mainModule.hash.slice(0, hashShort)}.js`), type: 'module' } : {},
            this.isDev ? { src: util.cleanPath(`${baseUrl}/_aleph/-/deno.land/x/aleph/nomodule.js`), nomodule: true } : {},
        ]
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

        const config: Record<string, any> = {}

        for (const name of Array.from(['ts', 'js', 'mjs', 'json']).map(ext => `aleph.config.${ext}`)) {
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
            const staticPaths = util.isArray(ssr.staticPaths) ? ssr.staticPaths.map(v => util.cleanPath(v.split('?')[0])) : []
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
        } else {
            for (const name of Array.from(['ts', 'js', 'mjs', 'json']).map(ext => `postcss.config.${ext}`)) {
                const p = path.join(this.appRoot, name)
                if (existsFileSync(p)) {
                    log.info('  ✓', name)
                    if (name.endsWith('.json')) {
                        const postcss = JSON.parse(await Deno.readTextFile(p))
                        if (util.isPlainObject(postcss) && util.isArray(postcss.plugins)) {
                            Object.assign(this.config, { postcss })
                        }
                    } else {
                        let { default: postcss } = await import('file://' + p)
                        if (util.isFunction(postcss)) {
                            postcss = await postcss()
                        }
                        if (util.isPlainObject(postcss) && util.isArray(postcss.plugins)) {
                            Object.assign(this.config, { postcss })
                        }
                    }
                    break
                }
            }
        }

        // update import map
        const { __ALEPH_DEV_PORT: devPort } = globalThis as any
        if (devPort) {
            const alias = `http://localhost:${devPort}/`
            const imports = {
                'https://deno.land/x/aleph/': [alias],
                [`https://deno.land/x/aleph@v${version}/`]: [alias],
                'aleph': [`${alias}mod.ts`],
                'aleph/': [alias],
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
        const t = performance.now()
        const alephPkgUrl = getAlephPkgUrl()
        const walkOptions = { includeDirs: false, exts: ['.ts', '.js', '.mjs'], skip: [/^\./, /\.d\.ts$/i, /\.(test|spec|e2e)\.m?(j|t)sx?$/i] }
        const apiDir = path.join(this.srcDir, 'api')
        const pagesDir = path.join(this.srcDir, 'pages')

        if (!(existsDirSync(pagesDir))) {
            log.fatal(`'pages' directory not found.`)
        }

        const p = Deno.run({
            cmd: ['deno', 'info'],
            stdout: 'piped',
            stderr: 'null'
        })
        this.#denoCacheDir = (new TextDecoder).decode(await p.output()).split('"')[1]
        p.close()
        if (!existsDirSync(this.#denoCacheDir)) {
            log.fatal('invalid deno cache dir')
        }

        if (reload) {
            this.#reloading = true
            if (existsDirSync(this.buildDir)) {
                await Deno.remove(this.buildDir, { recursive: true })
            }
            await ensureDir(this.buildDir)
        }

        log.info(colors.bold(`Aleph.js v${version}`))
        log.info(colors.bold('- Global'))
        await this._loadConfig()

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

        // check custom components
        for await (const { path: p, } of walk(this.srcDir, { ...walkOptions, maxDepth: 1, exts: [...walkOptions.exts, '.tsx', '.jsx'] })) {
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

        // create api routing
        if (existsDirSync(apiDir)) {
            for await (const { path: p } of walk(apiDir, walkOptions)) {
                const mod = await this._compile(util.cleanPath('/api/' + util.trimPrefix(p, apiDir)))
                this.#apiRouting.update(this._getRouteModule(mod))
            }
        }

        // create page routing
        for await (const { path: p } of walk(pagesDir, { ...walkOptions, exts: [...walkOptions.exts, '.tsx', '.jsx', '.md'] })) {
            const mod = await this._compile(util.cleanPath('/pages/' + util.trimPrefix(p, pagesDir)))
            this.#pageRouting.update(this._getRouteModule(mod))
        }

        // create main module
        await this._createMainModule()

        // pre-compile some modules
        if (this.isDev) {
            for (const mod of [
                'hmr.ts',
                'nomodule.ts',
            ]) {
                await this._compile(`${alephPkgUrl}/${mod}`)
            }
        }

        // import renderer
        const rendererUrl = `${alephPkgUrl}/framework/${this.config.framework}/renderer.ts`
        await this._compile(rendererUrl)
        const { renderPage } = await import('file://' + this.#modules.get(rendererUrl)!.jsFile)
        this.#renderer = { renderPage }


        // reload end
        if (reload) {
            this.#reloading = false
        }

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

        log.debug('init project in ' + Math.round(performance.now() - t) + 'ms')

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
                    util.debounceX(path, () => {
                        const shouldUpdateMainModule = (() => {
                            switch (path.replace(reModuleExt, '')) {
                                case '/404':
                                case '/app':
                                    return true
                                default:
                                    if (path.startsWith('/pages/')) {
                                        return true
                                    }
                                    return false
                            }
                        })()
                        if (existsFileSync(p)) {
                            let type = 'modify'
                            if (!this.#modules.has(path)) {
                                type = 'add'
                            }
                            log.info(type, path)
                            this._compile(path, { forceCompile: true }).then(mod => {
                                const hmrable = this.isHMRable(mod.url)
                                if (hmrable) {
                                    if (type === 'add') {
                                        this.#fsWatchListeners.forEach(e => e.emit('add', mod.url, mod.hash))
                                    } else {
                                        this.#fsWatchListeners.forEach(e => e.emit('modify-' + mod.url, mod.hash))
                                    }
                                }
                                if (path.replace(reModuleExt, '') === '/app') {
                                    this.#rendered.clear()
                                } else if (path.startsWith('/pages/')) {
                                    this.#rendered.delete(getPagePath(path))
                                    this.#pageRouting.update(this._getRouteModule(mod))
                                } else if (path.startsWith('/api/')) {
                                    this.#apiRouting.update(this._getRouteModule(mod))
                                }
                                if (shouldUpdateMainModule) {
                                    this._createMainModule()
                                }
                                this._updateHash(path, mod.hash, ({ url, hash }) => {
                                    if (url.startsWith('/pages/')) {
                                        this.#rendered.delete(getPagePath(url))
                                    }
                                    if (!hmrable && this.isHMRable(url)) {
                                        this.#fsWatchListeners.forEach(e => e.emit('modify-' + url, hash))
                                    }
                                })
                            }).catch(err => {
                                log.error(`compile(${path}):`, err.message)
                            })
                        } else if (this.#modules.has(path)) {
                            if (path.replace(reModuleExt, '') === '/app') {
                                this.#rendered.clear()
                            } else if (path.startsWith('/pages/')) {
                                this.#rendered.delete(getPagePath(path))
                                this.#pageRouting.removeRoute(path)
                            } else if (path.startsWith('/api/')) {
                                this.#apiRouting.removeRoute(path)
                            }
                            if (shouldUpdateMainModule) {
                                this._createMainModule()
                            }
                            this.#modules.delete(path)
                            if (this.isHMRable(path)) {
                                this.#fsWatchListeners.forEach(e => e.emit('remove', path))
                            }
                            log.info('remove', path)
                        }
                    }, 150)
                }
            }
        }
    }

    /** returns the route module by given module url and hash. */
    private _getRouteModule({ url, hash }: Module): RouteModule {
        const deps = this._lookupDeps(url).filter(({ isData }) => !!isData)
        return { url, hash, deps: deps.length > 0 ? deps : undefined }
    }

    /** create re-compiled main module. */
    private async _createMainModule(): Promise<void> {
        const alephPkgUrl = getAlephPkgUrl()
        const { baseUrl, defaultLocale, framework } = this.config
        const config: Record<string, any> = {
            baseUrl,
            defaultLocale,
            locales: [],
            routes: this.#pageRouting.routes,
            preloadModules: Array.from(this.#modules.keys())
                .filter(url => {
                    const name = url.replace(reModuleExt, '')
                    return name == '/404' || name == '/app'
                })
                .map(url => this._getRouteModule(this.#modules.get(url)!)),
            renderMode: this.config.ssr ? 'ssr' : 'spa'
        }
        const sourceCode = [
            (this.config.framework === 'react' && this.isDev) && `import "${alephPkgUrl}/framework/react/refresh.ts"`,
            `import bootstrap from "${alephPkgUrl}/framework/${framework}/bootstrap.ts"`,
            `bootstrap(${JSON.stringify(config)})`
        ].filter(Boolean).join('\n')
        await this._compile('/main.ts', { sourceCode })
        if (!this.isDev) {
            await this._compile('/main.ts', { sourceCode, bundleMode: true })
        }
    }

    /** preprocess css with postcss plugins */
    private async _preprocessCSS(sourceCode: string, isLess: boolean) {
        let css: string = sourceCode
        if (isLess) {
            try {
                const output = await less.render(sourceCode || '/* empty content */')
                css = output.css
            } catch (error) {
                throw new Error(`less: ${error}`);
            }
        }


        if (this.#postcssReady === null) {
            this.#postcssReady = Promise.all(this.config.postcss.plugins.map(async p => {
                let name: string | null = null
                if (util.isNEString(p)) {
                    name = p
                } else if (Array.isArray(p) && util.isNEString(p[0])) {
                    name = p[0]
                }
                if (name) {
                    const { default: Plugin } = await import(`https://esm.sh/${name}?external=postcss@8.1.4&no-check`)
                    this.#postcssPlugins[name] = Plugin
                }
            }))
        }
        await this.#postcssReady
        css = (await postcss(this.config.postcss.plugins.map(p => {
            if (typeof p === 'string') {
                return this.#postcssPlugins[p]
            } else if (Array.isArray(p)) {
                const [plugin, options] = p
                if (util.isNEString(plugin)) {
                    const _plugin = this.#postcssPlugins[plugin]
                    if (util.isFunction(_plugin)) {
                        let fn = _plugin as Function
                        return fn(options)
                    } else {
                        return plugin
                    }
                } else {
                    plugin(options)
                }
            } else {
                return p
            }
        })).process(css).async()).content
        if (!this.isDev) {
            const output = this.#cleanCSS.minify(css)
            css = output.styles
        }
        return css
    }

    /** transpile code no types checking. */
    private async _transpile(sourceCode: string, options: TransformOptions) {
        if (this.#swcReady === null) {
            this.#swcReady = initWasm(this.#denoCacheDir)
        }
        await this.#swcReady
        return transpileSync(sourceCode, options)
    }

    /** download and compile a moudle by given url, then cache on the disk. */
    private async _compile(
        url: string,
        options?: {
            sourceCode?: string,
            sourceHash?: string,
            loader?: string,
            forceCompile?: boolean,
            bundleMode?: boolean,
            bundledPaths?: string[]
        }
    ): Promise<Module> {
        const alephPkgUrl = getAlephPkgUrl()
        const isRemote = reHttp.test(url)
        const localUrl = fixImportUrl(url)
        const name = path.basename(localUrl).replace(reModuleExt, '')
        const saveDir = path.join(this.buildDir, path.dirname(localUrl))
        const metaFile = path.join(saveDir, `${name}.meta.json`)

        let mod: Module
        if (this.#modules.has(url)) {
            mod = this.#modules.get(url)!
            if (!options?.forceCompile && !options?.sourceCode && !(options?.bundleMode && mod.bundlingFile === '')) {
                return mod
            }
        } else {
            mod = newModule(url)
            try {
                if (existsFileSync(metaFile)) {
                    const { url, sourceHash, hash, deps } = JSON.parse(await Deno.readTextFile(metaFile))
                    if (url === url && util.isNEString(sourceHash) && util.isNEString(hash) && util.isArray(deps)) {
                        mod.sourceHash = sourceHash
                        mod.hash = hash
                        mod.deps = deps
                    } else {
                        log.warn(`invalid metadata ('${name}.meta.json')`)
                        Deno.remove(metaFile)
                    }
                }
            } catch (e) { }
        }

        let sourceContent = new Uint8Array()
        let shouldCompile = false
        let fsync = false
        let jsContent = ''
        let jsMap: string | null = null

        if (options?.sourceCode) {
            sourceContent = (new TextEncoder).encode(options.sourceCode)
            const sourceHash = options?.sourceHash || (new Sha1).update(sourceContent).hex()
            if (mod.sourceHash === '' || mod.sourceHash !== sourceHash) {
                mod.sourceHash = sourceHash
                shouldCompile = true
            }
        } else if (isRemote) {
            if (/^https?:\/\/localhost(:\d+)?\//.test(url)) {
                try {
                    const content = await fetch(url).then(resp => resp.text())
                    sourceContent = (new TextEncoder).encode(content)
                    const sourceHash = (new Sha1).update(sourceContent).hex()
                    if (mod.sourceHash === '' || mod.sourceHash !== sourceHash) {
                        mod.sourceHash = sourceHash
                        shouldCompile = true
                    }
                } catch (err) {
                    throw new Error(`Download ${url}: ${err.message}`)
                }
            } else {
                try {
                    sourceContent = await this._loadDependency(url)
                    const sourceHash = (new Sha1).update(sourceContent).hex()
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
                const sourceHash = (new Sha1).update(sourceContent).hex()
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

        // check previous compile output
        if (!shouldCompile) {
            if (!options?.bundleMode) {
                let jsFile = path.join(saveDir, name + (isRemote ? '' : `.${mod.hash.slice(0, hashShort)}`) + '.js')
                if (existsFileSync(jsFile)) {
                    mod.jsFile = jsFile
                } else {
                    shouldCompile = true
                }
            } else {
                let bundlingFile = path.join(saveDir, `${name}.bundling.${mod.sourceHash.slice(0, hashShort)}.js`)
                if (existsFileSync(bundlingFile)) {
                    mod.bundlingFile = bundlingFile
                } else {
                    shouldCompile = true
                }
            }
        }

        // compile source code
        if (shouldCompile) {
            let sourceCode = (new TextDecoder).decode(sourceContent)
            let loader = mod.loader
            if (!!options?.loader) {
                loader = options.loader
            } else {
                for (const plugin of this.config.plugins) {
                    if (plugin.test.test(url) && util.isFunction(plugin.transform)) {
                        const { code, loader: pluginLodaer = 'js' } = await plugin.transform(sourceContent, url)
                        sourceCode = code
                        loader = pluginLodaer
                        mod.loader = pluginLodaer
                        break
                    }
                }
            }

            if (loader === 'css') {
                const css = await this._preprocessCSS(sourceCode, url.endsWith('.less'))
                return await this._compile(url, {
                    ...options,
                    loader: 'js',
                    sourceCode: (`
                        import { applyCSS } from "${alephPkgUrl}/framework/${this.config.framework}/style.ts";\
                        applyCSS(${JSON.stringify(url)}, ${JSON.stringify(this.isDev ? `\n${css.trim()}\n` : css)});
                    `).replaceAll(' '.repeat(24), '').trim(),
                    sourceHash: mod.sourceHash
                })
            } else if (loader === 'markdown') {
                const { __content, ...props } = safeLoadFront(sourceCode)
                const html = marked.parse(__content)
                return await this._compile(url, {
                    ...options,
                    loader: 'js',
                    sourceCode: (`
                        import React, { useEffect, useRef } from ${JSON.stringify(this.config.reactUrl)};
                        import { redirect } from "${alephPkgUrl}/framework/${this.config.framework}/anchor.ts";
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
                    sourceHash: mod.sourceHash
                })
            } else if (loader === 'js' || loader === 'ts' || loader === 'jsx' || loader === 'tsx') {
                const t = performance.now()
                const swcOptions: SWCOptions = {
                    target: 'es2020',
                    sourceType: loader,
                    sourceMap: true,
                }
                const { code, map, deps, inlineStyles } = await this._transpile(sourceCode, {
                    url,
                    swcOptions,
                    importMap: this.importMap,
                    reactUrl: this.config.reactUrl,
                    reactDomUrl: this.config.reactDomUrl,
                    isDev: this.isDev,
                    bundleMode: options?.bundleMode,
                    bundledPaths: options?.bundledPaths
                })

                jsContent = code
                jsMap = map!

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
                        tpl = await this._preprocessCSS(tpl, type === 'less')
                        tpl = tpl.replace(
                            /\: var\(--aleph-inline-style-expr-(\d+)\)/g,
                            (_, id) => ': ${' + style.exprs[parseInt(id)] + '}'
                        ).replace(
                            /\/\*%%aleph-inline-style-expr-(\d+)%%\*\//g,
                            (_, id) => '${' + style.exprs[parseInt(id)] + '}'
                        )
                        jsContent = jsContent.replace(`"%%${key}-placeholder%%"`, '`' + tpl + '`')
                    }
                }))

                mod.deps = deps.map(({ specifier, isDynamic }) => {
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
                    return dep
                })

                fsync = true

                log.debug(`compile '${url}' in ${Math.round(performance.now() - t)}ms ${!!options?.bundleMode ? '(bundle mode)' : ''}`)
            } else {
                throw new Error(`Unknown loader '${loader}'`)
            }
        }

        // compile deps
        const deps = mod.deps.filter(({ url }) => {
            return !url.startsWith('#') && (!options?.bundleMode || (!reHttp.test(url) && !options?.bundledPaths?.includes(url)))
        })
        for (const dep of deps) {
            const depMod = await this._compile(dep.url, { bundleMode: options?.bundleMode, bundledPaths: options?.bundledPaths })
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
                    if (!shouldCompile) {
                        jsContent = await Deno.readTextFile(mod.jsFile)
                    }
                    jsContent = jsContent.replace(reHashResolve, (s, key, spaces, ql, importPath, qr) => {
                        if (importPath.slice(0, - (hashShort + 4)) === depImportPath) {
                            if (!options?.bundleMode) {
                                return `${key}${spaces}${ql}${depImportPath}.${dep.hash.slice(0, hashShort)}.js${qr}`
                            } else {
                                return `${key}${spaces}${ql}${depImportPath}.bundling.${depMod.sourceHash.slice(0, hashShort)}.js${qr}`
                            }
                        }
                        return s
                    })
                    if (!fsync) {
                        fsync = true
                    }
                }
            }
        }

        if (fsync) {
            if (!options?.bundleMode) {
                mod.hash = (new Sha1).update(jsContent).hex()
                mod.jsFile = path.join(saveDir, name + (isRemote ? '' : `.${mod.hash.slice(0, hashShort)}`) + '.js')
                await cleanupCompilation(mod.jsFile)
                await Promise.all([
                    ensureTextFile(mod.jsFile, jsContent),
                    jsMap ? ensureTextFile(mod.jsFile + '.map', jsMap) : Promise.resolve(),
                    ensureTextFile(metaFile, JSON.stringify({
                        url,
                        sourceHash: mod.sourceHash,
                        hash: mod.hash,
                        deps: mod.deps,
                    }, undefined, 4)),
                ])
            } else {
                mod.bundlingFile = path.join(saveDir, `${name}.bundling.${mod.sourceHash.slice(0, hashShort)}.js`)
                await cleanupCompilation(mod.bundlingFile)
                await Promise.all([
                    await ensureTextFile(mod.bundlingFile, jsContent),
                    await ensureTextFile(metaFile, JSON.stringify({
                        url,
                        sourceHash: mod.sourceHash,
                        hash: mod.hash || mod.sourceHash,
                        deps: mod.deps,
                    }, undefined, 4))
                ])
            }
        }

        if (!this.#modules.has(url)) {
            this.#modules.set(url, mod)
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
                        if (mod.url === '/main.ts') {
                            this._createMainModule()
                        } else {
                            const depImportPath = getRelativePath(
                                path.dirname(mod.url),
                                dep.url.replace(reModuleExt, '')
                            )
                            Deno.readTextFile(mod.jsFile).then(jsContent => {
                                jsContent = jsContent.replace(reHashResolve, (s, key, spaces, ql, importPath, qr) => {
                                    if (importPath.slice(0, - (hashShort + 4)) === depImportPath) {
                                        return `${key}${spaces}${ql}${depImportPath}.${dep.hash.slice(0, hashShort)}.js${qr}`
                                    }
                                    return s
                                })
                                mod.hash = (new Sha1).update(jsContent).hex()
                                mod.jsFile = `${mod.jsFile.replace(reHashJs, '')}.${mod.hash.slice(0, hashShort)}.js`
                                cleanupCompilation(mod.jsFile).then(() => {
                                    Promise.all([
                                        ensureTextFile(mod.jsFile.replace(reHashJs, '') + '.meta.json', JSON.stringify({
                                            url: mod.url,
                                            sourceHash: mod.sourceHash,
                                            hash: mod.hash,
                                            deps: mod.deps,
                                        }, undefined, 4)),
                                        ensureTextFile(mod.jsFile, jsContent)
                                    ])
                                })
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
        const u = new URL(url)
        if (url.startsWith('https://esm.sh/')) {
            if (this.isDev && !u.searchParams.has('dev')) {
                u.searchParams.set('dev', '')
            }
            u.search = u.search.replace(/\=(&|$)/, '$1')
        }

        const { protocol, hostname, port, pathname, search } = u
        const versioned = reFullVersion.test(pathname)
        const dir = path.join(this.#denoCacheDir, 'deps', util.trimSuffix(protocol, ':'), hostname + (port ? '_PORT' + port : ''))
        const filename = path.join(dir, (new Sha256()).update(pathname + search).hex())

        if (versioned && !this.#reloading && existsFileSync(filename)) {
            return await Deno.readFile(filename)
        }

        const p = Deno.run({
            cmd: [
                'deno',
                'cache',
                this.#reloading || !versioned ? '--reload' : '',
                u.toString()
            ].filter(Boolean),
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
        const header = `
            var __ALEPH = window.__ALEPH || (window.__ALEPH = {
                pack: {},
                exportFrom: function(specifier, url, exports) {
                    if (url in this.pack) {
                        var mod = this.pack[url]
                        if (!(specifier in this.pack)) {
                            this.pack[specifier] = {}
                        }
                        if (exports === '*') {
                            for (var k in mod) {
                                this.pack[specifier][k] = mod[k]
                            }
                        } else if (typeof exports === 'object' && exports !== null) {
                            for (var k in exports) {
                                this.pack[specifier][exports[k]] = mod[k]
                            }
                        }
                    }
                }
            });
        `.replaceAll(' '.repeat(12), '')
        const alephPkgUrl = getAlephPkgUrl()
        const refCounter = new Map<string, number>()
        const lookup = (url: string) => {
            if (this.#modules.has(url)) {
                const { deps } = this.#modules.get(url)!
                deps.forEach(({ url }) => {
                    if (!refCounter.has(url)) {
                        refCounter.set(url, 1)
                    } else {
                        refCounter.set(url, refCounter.get(url)! + 1)
                    }
                })
            }
        }
        const appModule = Array.from(this.#modules.keys())
            .filter(url => url.replace(reModuleExt, '') === '/app')
            .map(url => this.#modules.get(url))[0]
        const e404Module = Array.from(this.#modules.keys())
            .filter(url => url.replace(reModuleExt, '') === '/404')
            .map(url => this.#modules.get(url))[0]
        const pageModules: Module[] = []

        lookup('/main.ts')
        if (appModule) {
            await this._compile(appModule.url, { bundleMode: true })
            lookup(appModule.url)
        }
        if (e404Module) {
            await this._compile(e404Module.url, { bundleMode: true })
            lookup(e404Module.url)
        }
        this.#pageRouting.lookup(routes => routes.forEach(({ module: { url } }) => {
            const mod = this.getModule(url)
            if (mod) {
                lookup(url)
                pageModules.push(mod)
            }
        }))

        const remoteDepList: string[] = []
        const localDepList: string[] = []
        Array.from(refCounter.entries()).forEach(([url, count]) => {
            if (reHttp.test(url)) {
                remoteDepList.push(url)
            } else if (!url.startsWith('#') && !url.startsWith('/pages/') && count > 1) {
                localDepList.push(url)
            }
        })
        if (appModule) {
            localDepList.push(appModule.url)
        }
        if (e404Module) {
            localDepList.push(e404Module.url)
        }

        log.info('- Bundle')
        await this._createChunkBundle('deps', remoteDepList, header)
        if (localDepList.length > 0) {
            await this._createChunkBundle('shared', localDepList, header)
        }

        // copy main module
        const mainModule = this.getModule('/main.ts')!
        const mainJSFile = path.join(this.outputDir, '_aleph', `main.${mainModule.sourceHash.slice(0, hashShort)}.js`)
        const mainJSConent = await Deno.readTextFile(mainModule.bundlingFile)
        await Deno.writeTextFile(mainJSFile, mainJSConent)

        // create and copy ployfill
        const ployfillMode = newModule('/ployfill.js')
        ployfillMode.hash = ployfillMode.sourceHash = (new Sha1).update(header).update(`${this.config.buildTarget}-${version}`).hex()
        const ployfillFile = path.join(this.buildDir, `ployfill.${ployfillMode.hash.slice(0, hashShort)}.js`)
        if (!existsFileSync(ployfillFile)) {
            const rawPloyfillFile = `${alephPkgUrl}/compiler/ployfills/${this.config.buildTarget}/ployfill.js`
            await this._runDenoBundle(rawPloyfillFile, ployfillFile, header, true)
        }
        Deno.copyFile(ployfillFile, path.join(this.outputDir, '_aleph', `ployfill.${ployfillMode.hash.slice(0, hashShort)}.js`))
        this.#modules.set(ployfillMode.url, ployfillMode)

        // bundle and copy page moudles
        await Promise.all(pageModules.map(async mod => this._createPageBundle(mod, localDepList, header)))
    }

    /** create chunk bundle. */
    private async _createChunkBundle(name: string, list: string[], header = '') {
        const imports = list.map((url, i) => {
            const mod = this.#modules.get(url)
            if (mod) {
                return [
                    `import * as ${name}_mod_${i} from ${JSON.stringify(reHttp.test(mod.url) ? mod.jsFile : mod.bundlingFile)}`,
                    `__ALEPH.pack[${JSON.stringify(url)}] = ${name}_mod_${i}`
                ]
            }
        }).flat().join('\n')
        const bundlingCode = imports
        const mod = newModule(`/${name}.bundling.js`)
        mod.hash = (new Sha1).update(header).update(bundlingCode).hex()
        const bundlingFile = path.join(this.buildDir, mod.url)
        const bundleFile = path.join(this.buildDir, `${name}.bundle.${mod.hash.slice(0, hashShort)}.js`)
        const saveAs = path.join(this.outputDir, `_aleph/${name}.${mod.hash.slice(0, hashShort)}.js`)

        if (existsFileSync(bundleFile)) {
            this.#modules.set(mod.url, mod)
            await Deno.copyFile(bundleFile, saveAs)
            return
        }

        await Deno.writeTextFile(bundlingFile, bundlingCode)
        const n = await this._runDenoBundle(bundlingFile, bundleFile, header)
        if (n > 0) {
            log.info(`  {} ${name}.js ${colors.dim('• ' + util.bytesString(n))}`)
        }

        this.#modules.set(mod.url, mod)
        await Deno.copyFile(bundleFile, saveAs)
        Deno.remove(bundlingFile)
    }

    /** create page bundle. */
    private async _createPageBundle(mod: Module, bundledPaths: string[], header = '') {
        const { bundlingFile, sourceHash } = await this._compile(mod.url, { bundleMode: true, bundledPaths })
        const _tmp = util.trimSuffix(bundlingFile.replace(reHashJs, ''), '.bundling')
        const _tmp_bundlingFile = _tmp + `.bundling.js`
        const bundleFile = _tmp + `.bundle.${sourceHash.slice(0, hashShort)}.js`
        const saveAs = path.join(this.outputDir, `/_aleph/`, util.trimPrefix(_tmp, this.buildDir) + `.${sourceHash.slice(0, hashShort)}.js`)

        if (existsFileSync(bundleFile)) {
            await ensureDir(path.dirname(saveAs))
            await Deno.copyFile(bundleFile, saveAs)
            return
        }

        const bundlingCode = [
            `import * as mod from ${JSON.stringify(bundlingFile)}`,
            `__ALEPH.pack[${JSON.stringify(mod.url)}] = mod`
        ].join('\n')
        await Deno.writeTextFile(_tmp_bundlingFile, bundlingCode)
        await this._runDenoBundle(_tmp_bundlingFile, bundleFile, header)
        await ensureDir(path.dirname(saveAs))
        await Deno.copyFile(bundleFile, saveAs)
        Deno.remove(_tmp_bundlingFile)
    }

    /** run deno bundle and compess the output with terser. */
    private async _runDenoBundle(bundlingFile: string, bundleFile: string, header = '', reload = false) {
        const p = Deno.run({
            cmd: ['deno', 'bundle', '--no-check', reload ? '--reload' : '', bundlingFile, bundleFile].filter(Boolean),
            stdout: 'null',
            stderr: 'piped'
        })
        const data = await p.stderrOutput()
        p.close()
        if (!existsFileSync(bundleFile)) {
            const msg = (new TextDecoder).decode(data).replaceAll('file://', '').replaceAll(this.buildDir, '/aleph.js')
            await Deno.stderr.write((new TextEncoder).encode(msg))
            Deno.exit(1)
        }

        // transpile bundle code to `buildTarget`
        let { code } = await this._transpile(await Deno.readTextFile(bundleFile), {
            url: '/bundle.js',
            swcOptions: {
                target: this.config.buildTarget
            },
        })

        // IIFEify
        code = [
            '(() => {',
            header,
            code,
            '})()'
        ].join('\n')

        // minify code
        // const ret = await minify(code, {
        //     compress: true,
        //     mangle: true,
        //     ecma: parseInt(util.trimPrefix(this.config.buildTarget, 'es')) as ECMA,
        //     sourceMap: false
        // })
        // if (ret.code) {
        //     code = ret.code
        // }

        await cleanupCompilation(bundleFile)
        await Deno.writeTextFile(bundleFile, code)
        return code.length
    }

    /** optimize images for production. */
    private async _optimize() {

    }

    /** render all pages in routing. */
    private async _ssg() {
        const { ssr } = this.config
        const outputDir = this.outputDir

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
                            const dataFile = path.join(outputDir, '_aleph/data', (pathname === '/' ? 'index' : pathname) + '.json')
                            await ensureTextFile(dataFile, JSON.stringify(data))
                        }
                        log.info('  ○', pathname, colors.dim('• ' + util.bytesString(html.length)))
                    } else if (status == 404) {
                        log.info('  ○', colors.dim(pathname), colors.red('Page not found'))
                    } else if (status == 500) {
                        log.info('  ○', colors.dim(pathname), colors.red('Error 500'))
                    }
                }
            }))
            const fallbackSpaHtmlFile = path.join(outputDir, util.isPlainObject(ssr) && ssr.fallback ? ssr.fallback : '_fallback_spa.html')
            await ensureTextFile(fallbackSpaHtmlFile, await this.getSPAIndexHtml())
        } else {
            await ensureTextFile(path.join(outputDir, 'index.html'), await this.getSPAIndexHtml())
        }

        // write 404 page
        const { url, head, scripts, body, data } = await this._render404Page()
        const e404PageHtml = createHtml({
            lang: url.locale,
            head: head,
            scripts: [
                data ? { type: 'application/json', innerText: JSON.stringify(data), id: 'ssr-data' } : '',
                ...this._getPreloadScripts(),
                ...scripts
            ],
            body,
            minify: !this.isDev
        })
        await ensureTextFile(path.join(outputDir, '404.html'), e404PageHtml)
        if (data) {
            const dataFile = path.join(outputDir, '_aleph/data/_404.json')
            await ensureTextFile(dataFile, JSON.stringify(data))
        }
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
            const appModule = Array.from(this.#modules.keys())
                .filter(url => url.replace(reModuleExt, '') == '/app')
                .map(url => this.#modules.get(url))[0]
            const { default: App } = appModule ? await import('file://' + appModule.jsFile) : {} as any
            const pageComponentTree: { url: string, Component?: any }[] = pageModuleTree.map(({ url }) => ({ url }))
            const imports = pageModuleTree.map(async ({ url }) => {
                const mod = this.#modules.get(url)!
                const { default: C } = await import('file://' + mod.jsFile)
                const pc = pageComponentTree.find(pc => pc.url === mod.url)
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
                    appModule ? this._lookupDeps(appModule.url).filter(dep => !!dep.isStyle) : [],
                    ...pageModuleTree.map(({ url }) => this._lookupDeps(url).filter(dep => !!dep.isStyle)).flat()
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
            const e404Module = Array.from(this.#modules.keys())
                .filter(url => url.replace(reModuleExt, '') == '/404')
                .map(url => this.#modules.get(url))[0]
            const { default: E404 } = e404Module ? await import('file://' + e404Module.jsFile) : {} as any
            const { head, body, data, scripts } = await this.#renderer.renderPage(
                url,
                undefined,
                E404,
                [],
                e404Module ? this._lookupDeps(e404Module.url).filter(dep => !!dep.isStyle) : []
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
        const loadingModule = Array.from(this.#modules.keys())
            .filter(url => url.replace(reModuleExt, '') == '/loading')
            .map(url => this.#modules.get(url))[0]
        if (loadingModule) {
            const { default: Loading } = await import('file://' + loadingModule.jsFile)
            const router = {
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
                router,
                undefined,
                undefined,
                [{ url: loadingModule.url, Component: Loading }],
                this._lookupDeps(loadingModule.url).filter(dep => !!dep.isStyle)
            )
            return {
                head,
                body: `<main>${body}</main>`
            } as Pick<RenderResult, 'head' | 'body'>
        }
        return null
    }

    private _lookupDeps(url: string, __deps: DependencyDescriptor[] = [], __tracing: Set<string> = new Set()) {
        const mod = this.getModule(url)
        if (!mod) {
            return __deps
        }
        if (__tracing.has(url)) {
            return __deps
        }
        __tracing.add(url)
        __deps.push(...mod.deps.filter(({ url }) => __deps.findIndex(i => i.url === url) === -1))
        mod.deps.forEach(({ url }) => {
            if (reModuleExt.test(url) && !reHttp.test(url)) {
                this._lookupDeps(url, __deps, __tracing)
            }
        })
        return __deps
    }
}
