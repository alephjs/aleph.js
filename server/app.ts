import { buildChecksum, initWasm, SWCOptions, TransformOptions, transpileSync } from '../compiler/mod.ts'
import type { AcceptedPlugin, ECMA } from '../deps.ts'
import { CleanCSS, colors, ensureDir, minify, path, postcss, Sha1, Sha256, walk } from '../deps.ts'
import { EventEmitter } from '../framework/core/events.ts'
import { getPagePathname, isPageModule, RouteModule, Routing, trimPageModuleExt } from '../framework/core/routing.ts'
import { defaultReactVersion, pageModuleExts } from '../shared/constants.ts'
import { ensureTextFile, existsDirSync, existsFileSync } from '../shared/fs.ts'
import log from '../shared/log.ts'
import util from '../shared/util.ts'
import type { Config, DependencyDescriptor, ImportMap, Module, RenderResult, RouterURL, ServerRequest } from '../types.ts'
import { VERSION } from '../version.ts'
import { Request } from './api.ts'
import { AlephRuntimeCode, cleanupCompilation, createHtml, fixImportMap, formatBytesWithColor, getAlephPkgUrl, getRelativePath, reFullVersion, reHashJs, reHashResolve, reLocaleID, respondErrorJSON } from './util.ts'

/**
 * The Aleph Server Appliaction class.
 */
export class Appliaction {
    readonly workingDir: string
    readonly mode: 'development' | 'production'
    readonly config: Readonly<Required<Config>>
    readonly importMap: ImportMap
    readonly ready: Promise<void>

    #denoCacheDir = ''
    #modules: Map<string, Module> = new Map()
    #pageRouting: Routing = new Routing()
    #apiRouting: Routing = new Routing()
    #fsWatchListeners: Array<EventEmitter> = []
    #renderer: { render: CallableFunction } = { render: () => { } }
    #renderCache: Map<string, Map<string, RenderResult>> = new Map()
    #postcssPlugins: Record<string, AcceptedPlugin> = {}
    #cleanCSS = new CleanCSS({ compatibility: '*' /* Internet Explorer 10+ */ })
    #compilerReady: Promise<void> | boolean = false
    #postcssReady: Promise<void[]> | boolean = false
    #reloading = false

    constructor(workingDir = '.', mode: 'development' | 'production' = 'production', reload = false) {
        this.workingDir = path.resolve(workingDir)
        this.mode = mode
        this.config = {
            framework: 'react',
            srcDir: existsDirSync(path.join(this.workingDir, '/src/pages')) ? '/src' : '/',
            outputDir: '/dist',
            baseUrl: '/',
            defaultLocale: 'en',
            env: {},
            locales: [],
            ssr: {},
            buildTarget: 'es5',
            reactVersion: defaultReactVersion,
            plugins: [],
            postcss: {
                plugins: [
                    'autoprefixer'
                ]
            }
        }
        this.importMap = { imports: {}, scopes: {} }
        this.ready = this.init(reload)
    }

    get isDev() {
        return this.mode === 'development'
    }

    get srcDir() {
        return path.join(this.workingDir, this.config.srcDir)
    }

    get outputDir() {
        return path.join(this.workingDir, this.config.outputDir)
    }

    get buildDir() {
        return path.join(this.workingDir, '.aleph', this.mode)
    }

    isHMRable(url: string) {
        if (!this.isDev) {
            return false
        }
        if (url.endsWith('.css') || url.endsWith('.pcss')) {
            return true
        }
        for (const ext of ['js', 'ts', 'mjs', 'jsx', 'tsx']) {
            if (url.endsWith('.' + ext)) {
                return url.startsWith('/pages/') ||
                    url.startsWith('/components/') ||
                    trimPageModuleExt(url) === '/app' ||
                    trimPageModuleExt(url) === '/404'
            }
        }
        for (const plugin of this.config.plugins) {
            if (plugin.type === 'loader' && plugin.test.test(url)) {
                return plugin.acceptHMR
            }
        }
        return false
    }

    /** create a new module by given url. */
    private newModule(url: string): Module {
        const mod = {
            url,
            loader: '',
            sourceHash: '',
            hash: '',
            deps: [],
            jsFile: '',
            bundlingFile: '',
            error: null,
        }
        const isRemote = util.isLikelyHttpURL(url)
        const { pathname } = new URL(util.isLikelyHttpURL(url) ? url : 'file://' + url)
        const ext = path.extname(pathname).slice(1).toLowerCase()
        if (/[a-z]/.test(ext)) {
            if (ext === 'css' || ext === 'pcss') {
                mod.loader = 'css'
            } else if (pageModuleExts.includes(ext)) {
                if (ext === 'mjs') {
                    mod.loader = 'js'
                } else {
                    mod.loader = ext
                }
            } else {
                for (const plugin of this.config.plugins) {
                    if (plugin.type === 'loader' && plugin.test.test(pathname)) {
                        mod.loader = ext
                        break
                    }
                }
            }
        } else if (isRemote) {
            mod.loader = 'js'
        }
        return mod
    }

    /** returns the module by given url. */
    getModule(url: string): Module | null {
        if (this.#modules.has(url)) {
            return this.#modules.get(url)!
        }
        return null
    }

    /** add a new page module by given path and source code. */
    async addPageModule(pathname: string, code: string): Promise<void> {
        const url = path.join('/pages/', util.cleanPath(pathname) + '.tsx')
        const mod = await this.compile(url, { sourceCode: code })
        this.#pageRouting.update(this.getRouteModule(mod))
    }

    /** add a new page module by given path and source code. */
    async removePageModule(pathname: string): Promise<void> {
        const url = path.join('/pages/', util.cleanPath(pathname) + '.tsx')
        if (this.#modules.has(url)) {
            await cleanupCompilation(this.#modules.get(url)!.jsFile)
            this.#modules.delete(url)
            this.#pageRouting.removeRoute(url)
        }
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

    async handleAPI(req: ServerRequest, loc: { pathname: string, search?: string }) {
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
                        respondErrorJSON(req, 500, 'handle not found')
                    }
                } catch (err) {
                    respondErrorJSON(req, 500, err.message)
                    log.error('invoke API:', err)
                }
            }
        } else {
            respondErrorJSON(req, 404, 'page not found')
        }
    }

    async getSSRData(loc: { pathname: string, search?: string }): Promise<[number, any]> {
        if (!this.isSSRable(loc.pathname)) {
            return [404, null]
        }

        const { status, data } = await this.renderPage(loc)
        return [status, data]
    }

    async getPageHtml(loc: { pathname: string, search?: string }): Promise<[number, string, Record<string, string> | null]> {
        if (!this.isSSRable(loc.pathname)) {
            const [url] = this.#pageRouting.createRouter(loc)
            return [url.pagePath === '' ? 404 : 200, await this.getSPAIndexHtml(), null]
        }

        const { url, status, head, scripts, body, data } = await this.renderPage(loc)
        const html = createHtml({
            lang: url.locale,
            head: head,
            scripts: [
                data ? { type: 'application/json', innerText: JSON.stringify(data, undefined, this.isDev ? 4 : 0), id: 'ssr-data' } : '',
                ...this.getScripts(),
                ...scripts
            ],
            body,
            minify: !this.isDev
        })
        return [status, html, data]
    }

    async getSPAIndexHtml() {
        const { defaultLocale } = this.config
        const customLoading = await this.renderLoadingPage()
        const html = createHtml({
            lang: defaultLocale,
            scripts: [
                ...this.getScripts()
            ],
            head: customLoading?.head || [],
            body: `<div id="__aleph">${customLoading?.body || ''}</div>`,
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
        await this.bundle()
        await this.optimize()
        await this.ssg()

        // copy public assets
        const publicDir = path.join(this.workingDir, 'public')
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
                log.info('  ∆', rp.split('\\').join('/'), colors.dim('•'), formatBytesWithColor(fi.size))
                n++
            }
        }

        log.info(`Done in ${Math.round(performance.now() - start)}ms`)
    }

    /** inject HMR code  */
    injectHMRCode({ url, loader }: Module, content: string): string {
        const { __ALEPH_DEV_PORT: devPort } = globalThis as any
        const alephModuleLocalUrlPreifx = devPort ? `http_localhost_${devPort}` : `deno.land/x/aleph@v${VERSION}`
        const localUrl = this.fixImportUrl(url)
        const hmrImportPath = getRelativePath(
            path.dirname(localUrl),
            `/-/${alephModuleLocalUrlPreifx}/framework/core/hmr.js`
        )
        const lines = [
            `import { createHotContext } from ${JSON.stringify(hmrImportPath)};`,
            `import.meta.hot = createHotContext(${JSON.stringify(url)});`
        ]
        const reactRefresh = this.config.framework === 'react' && isPageModule(url)
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
            if (loader === 'css') {
                lines.push('__applyCSS();')
            }
            lines.push('import.meta.hot.accept();')
        }
        return lines.join('\n')
    }

    private getScripts() {
        const baseUrl = path.join(this.config.baseUrl, '/_aleph/')
        const mainModule = this.#modules.get('/main.ts')!
        const depsModule = this.#modules.get('/deps.bundling.js')
        const sharedModule = this.#modules.get('/shared.bundling.js')
        const polyfillModule = this.#modules.get('/polyfill.js')

        return [
            polyfillModule ? { src: path.join(baseUrl, `polyfill.${util.shortHash(polyfillModule.sourceHash)}.js`) } : {},
            depsModule ? { src: path.join(baseUrl, `deps.${util.shortHash(depsModule.sourceHash)}.js`), } : {},
            sharedModule ? { src: path.join(baseUrl, `shared.${util.shortHash(sharedModule.sourceHash)}.js`), } : {},
            !this.isDev ? { src: path.join(baseUrl, `main.${util.shortHash(mainModule.sourceHash)}.js`), } : {},
            this.isDev ? { src: path.join(baseUrl, `main.${util.shortHash(mainModule.hash)}.js`), type: 'module' } : {},
            this.isDev ? { src: path.join(baseUrl, `-/deno.land/x/aleph/nomodule.js`), nomodule: true } : {},
        ]
    }

    /** load config from `aleph.config.(ts|js|json)` */
    private async loadConfig() {
        const config: Record<string, any> = {}

        for (const name of Array.from(['ts', 'js', 'json']).map(ext => 'aleph.config.' + ext)) {
            const p = path.join(this.workingDir, name)
            if (existsFileSync(p)) {
                log.info('Aleph server config loaded from', name)
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
            for (const name of Array.from(['ts', 'js', 'json']).map(ext => `postcss.config.${ext}`)) {
                const p = path.join(this.workingDir, name)
                if (existsFileSync(p)) {
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

        // todo: load ssr.config.ts

        // load import maps
        for (const filename of Array.from(['import_map', 'import-map', 'importmap']).map(name => `${name}.json`)) {
            const importMapFile = path.join(this.workingDir, filename)
            if (existsFileSync(importMapFile)) {
                const importMap = JSON.parse(await Deno.readTextFile(importMapFile))
                const imports: Record<string, string> = fixImportMap(importMap.imports)
                const scopes: Record<string, Record<string, string>> = {}
                if (util.isPlainObject(importMap.scopes)) {
                    Object.entries(importMap.scopes).forEach(([key, imports]) => {
                        scopes[key] = fixImportMap(imports)
                    })
                }
                Object.assign(this.importMap, { imports, scopes })
                break
            }
        }

        // update import map for alephjs dev env
        const { __ALEPH_DEV_PORT: devPort } = globalThis as any
        if (devPort) {
            const alias = `http://localhost:${devPort}/`
            const imports = {
                'https://deno.land/x/aleph/': alias,
                [`https://deno.land/x/aleph@v${VERSION}/`]: alias,
                'aleph': `${alias}mod.ts`,
                'aleph/': alias,
                'react': `https://esm.sh/react@${this.config.reactVersion}`,
                'react-dom': `https://esm.sh/react-dom@${this.config.reactVersion}`,
            }
            Object.assign(this.importMap.imports, imports)
        }

        // create page routing
        this.#pageRouting = new Routing([], this.config.baseUrl, this.config.defaultLocale, this.config.locales)
    }

    /** initialize project */
    private async init(reload: boolean) {
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

        await this.loadConfig()

        // change current work dir to appDoot
        Deno.chdir(this.workingDir)

        // inject env variables
        Object.entries(this.config.env).forEach(([key, value]) => Deno.env.set(key, value))
        Deno.env.set('ALEPH_VERSION', VERSION)
        Deno.env.set('BUILD_MODE', this.mode)

        // add react refresh helpers for ssr
        if (this.config.framework == "react" && this.isDev) {
            Object.assign(globalThis, {
                $RefreshReg$: () => { },
                $RefreshSig$: () => (type: any) => type,
            })
        }

        // check custom components
        for await (const { path: p, } of walk(this.srcDir, { ...walkOptions, maxDepth: 1, exts: [...walkOptions.exts, '.tsx', '.jsx'] })) {
            const name = path.basename(p)
            let isCustom = true
            switch (trimPageModuleExt(name)) {
                case 'app':
                case '404':
                case 'loading':
                    break
                default:
                    isCustom = false
                    break
            }
            if (isCustom) {
                await this.compile('/' + name)
            }
        }

        // create api routing
        if (existsDirSync(apiDir)) {
            for await (const { path: p } of walk(apiDir, walkOptions)) {
                const mod = await this.compile(util.cleanPath('/api/' + util.trimPrefix(p, apiDir)))
                this.#apiRouting.update(this.getRouteModule(mod))
            }
        }

        // create page routing
        for await (const { path: p } of walk(pagesDir, { ...walkOptions, exts: [...walkOptions.exts, '.tsx', '.jsx', '.md'] })) {
            const mod = await this.compile(util.cleanPath('/pages/' + util.trimPrefix(p, pagesDir)))
            this.#pageRouting.update(this.getRouteModule(mod))
        }

        // create main module
        await this.createMainModule()

        // pre-compile framework modules
        if (this.isDev) {
            const mods = ['hmr.ts', 'nomodule.ts']
            for (const mod of mods) {
                await this.compile(`${alephPkgUrl}/framework/core/${mod}`)
            }
        }

        // compile and import framework renderer when ssr is enable
        if (this.config.ssr) {
            const rendererUrl = `${alephPkgUrl}/framework/${this.config.framework}/renderer.ts`
            await this.compile(rendererUrl)
            const { render } = await import('file://' + this.#modules.get(rendererUrl)!.jsFile)
            this.#renderer = { render }
        }

        // apply server plugins
        for (const plugin of this.config.plugins) {
            if (plugin.type === 'server') {
                await plugin.onInit(this)
            }
        }

        // reload end
        if (reload) {
            this.#reloading = false
        }

        log.debug('init project in ' + Math.round(performance.now() - t) + 'ms')

        if (this.isDev) {
            this.watch()
        }
    }

    /** watch file changes, re-compile modules and send HMR signal. */
    private async watch() {
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
                    if (isPageModule(path)) {
                        switch (trimPageModuleExt(path)) {
                            case '/404':
                            case '/app':
                                return true
                            default:
                                if (path.startsWith('/api/')) {
                                    return true
                                }
                        }
                    }
                    if (path.startsWith('/pages/') && isPageModule(path)) {
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
                    return this.config.plugins.findIndex(p => p.type === 'loader' && p.test.test(path)) > -1
                })()
                if (validated) {
                    util.debounceX(path, () => {
                        const shouldUpdateMainModule = (() => {
                            switch (trimPageModuleExt(path)) {
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
                            this.compile(path, { forceCompile: true }).then(mod => {
                                const hmrable = this.isHMRable(mod.url)
                                if (hmrable) {
                                    if (type === 'add') {
                                        this.#fsWatchListeners.forEach(e => e.emit('add', this.getRouteModule(mod)))
                                    } else {
                                        this.#fsWatchListeners.forEach(e => e.emit('modify-' + mod.url, mod.hash))
                                    }
                                }
                                if (trimPageModuleExt(path) === '/app') {
                                    this.#renderCache.clear()
                                } else if (path.startsWith('/pages/')) {
                                    this.#renderCache.delete(getPagePathname(path))
                                    this.#pageRouting.update(this.getRouteModule(mod))
                                } else if (path.startsWith('/api/')) {
                                    this.#apiRouting.update(this.getRouteModule(mod))
                                }
                                if (shouldUpdateMainModule) {
                                    this.createMainModule()
                                }
                                this.updateHash(path, mod.hash, ({ url, hash }) => {
                                    if (url.startsWith('/pages/')) {
                                        this.#renderCache.delete(getPagePathname(url))
                                    }
                                    if (!hmrable && this.isHMRable(url)) {
                                        this.#fsWatchListeners.forEach(e => e.emit('modify-' + url, hash))
                                    }
                                })
                            }).catch(err => {
                                log.error(`compile(${path}):`, err.message)
                            })
                        } else if (this.#modules.has(path)) {
                            if (trimPageModuleExt(path) === '/app') {
                                this.#renderCache.clear()
                            } else if (path.startsWith('/pages/')) {
                                this.#renderCache.delete(getPagePathname(path))
                                this.#pageRouting.removeRoute(path)
                            } else if (path.startsWith('/api/')) {
                                this.#apiRouting.removeRoute(path)
                            }
                            if (shouldUpdateMainModule) {
                                this.createMainModule()
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

    /** returns the route module by given module. */
    private getRouteModule({ url, hash }: Module): RouteModule {
        const deps = this.lookupDeps(url).filter(({ isData, isStyle, isDynamic }) => !!(isData || (isStyle && isDynamic)))
        return { url, hash, asyncDeps: deps.length > 0 ? deps : undefined }
    }

    /** create re-compiled main module. */
    private async createMainModule(): Promise<void> {
        const alephPkgUrl = getAlephPkgUrl()
        const { baseUrl, defaultLocale, framework } = this.config
        const config: Record<string, any> = {
            baseUrl,
            defaultLocale,
            locales: [],
            routes: this.#pageRouting.routes,
            sharedModules: Array.from(this.#modules.keys())
                .filter(url => {
                    const name = trimPageModuleExt(url)
                    return name == '/404' || name == '/app'
                })
                .map(url => this.getRouteModule(this.#modules.get(url)!)),
            renderMode: this.config.ssr ? 'ssr' : 'spa'
        }
        const sourceCode = [
            (this.config.framework === 'react' && this.isDev) && `import "${alephPkgUrl}/framework/react/refresh.ts"`,
            `import bootstrap from "${alephPkgUrl}/framework/${framework}/bootstrap.ts"`,
            `bootstrap(${JSON.stringify(config, undefined, 4)})`
        ].filter(Boolean).join('\n')
        await this.compile('/main.ts', { sourceCode })
        if (!this.isDev) {
            await this.compile('/main.ts', { sourceCode, bundleMode: true })
        }
    }

    /** fix import url */
    private fixImportUrl(importUrl: string): string {
        const isRemote = util.isLikelyHttpURL(importUrl)
        if (isRemote) {
            const url = new URL(importUrl)
            let pathname = url.pathname
            let ok = [...pageModuleExts, 'css', 'pcss'].includes(path.extname(pathname).slice(1))
            if (ok) {
                for (const plugin of this.config.plugins) {
                    if (plugin.type === 'loader' && plugin.test.test(pathname)) {
                        ok = true
                        break
                    }
                }
            }
            if (!ok) {
                pathname += '.js'
            }
            let search = Array.from(url.searchParams.entries()).map(([key, value]) => value ? `${key}=${value}` : key)
            if (search.length > 0) {
                pathname += '_' + search.join(',')
            }
            return [
                '/-/',
                (url.protocol === 'http:' ? 'http_' : ''),
                url.hostname,
                (url.port ? '_' + url.port : ''),
                pathname
            ].join('')
        }
        return importUrl
    }

    /** preprocess css with postcss plugins */
    private async preprocessCSS(sourceCode: string) {
        let t: number | null = null
        if (this.#postcssReady === false) {
            t = performance.now()
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
        if (this.#postcssReady instanceof Promise) {
            await this.#postcssReady
            this.#postcssReady = true
        }
        if (t !== null) {
            log.debug(`${this.config.postcss.plugins.length} postcss plugins loaded in ${Math.round(performance.now() - t)}ms`)
        }
        const pcss = (await postcss(this.config.postcss.plugins.map(p => {
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
        })).process(sourceCode).async()).content
        if (!this.isDev) {
            return this.#cleanCSS.minify(pcss).styles
        } else {
            return pcss
        }
    }

    /** transpile code without types checking. */
    private async transpile(sourceCode: string, options: TransformOptions) {
        let t: number | null = null
        if (this.#compilerReady === false) {
            t = performance.now()
            this.#compilerReady = initWasm(this.#denoCacheDir)
        }
        if (this.#compilerReady instanceof Promise) {
            await this.#compilerReady
            this.#compilerReady = true
        }
        if (t !== null) {
            log.debug(`init compiler wasm in ${Math.round(performance.now() - t)}ms`)
        }

        return transpileSync(sourceCode, options)
    }

    /** download and compile a moudle by given url, then cache on the disk. */
    private async compile(
        url: string,
        options?: {
            sourceCode?: string,
            forceCompile?: boolean,
            bundleMode?: boolean,
            bundledModules?: string[]
        }
    ): Promise<Module> {
        const alephPkgUrl = getAlephPkgUrl()
        const isRemote = util.isLikelyHttpURL(url)
        const localUrl = this.fixImportUrl(url)
        const name = trimPageModuleExt(path.basename(localUrl))
        const saveDir = path.join(this.buildDir, path.dirname(localUrl))
        const metaFile = path.join(saveDir, `${name}.meta.json`)
        const { sourceCode, forceCompile, bundleMode, bundledModules } = options ?? {}

        let mod: Module
        if (this.#modules.has(url)) {
            mod = this.#modules.get(url)!
            if (!forceCompile && !sourceCode && !(bundleMode && mod.bundlingFile === '')) {
                return mod
            }
        } else {
            mod = this.newModule(url)
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
        let jsSourceMap: string | null = null

        if (sourceCode) {
            sourceContent = (new TextEncoder).encode(sourceCode)
            const sourceHash = (new Sha1).update(sourceContent).hex()
            if (mod.sourceHash === '' || mod.sourceHash !== sourceHash) {
                mod.sourceHash = sourceHash
                shouldCompile = true
            }
        } else if (isRemote) {
            const isLocalhost = /^https?:\/\/localhost(:\d+)?\//.test(url)
            if (['js', 'ts', 'jsx', 'tsx'].includes(mod.loader) && !isLocalhost) {
                try {
                    sourceContent = await this.loadDependency(url)
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
            } else {
                // cache non-localhost file to local drive
                try {
                    if (!isLocalhost) {
                        log.info('Download', url)
                    }
                    const buffer = await fetch(url).then(resp => resp.arrayBuffer())
                    sourceContent = await Deno.readAll(new Deno.Buffer(buffer))
                    const sourceHash = (new Sha1).update(sourceContent).hex()
                    if (mod.sourceHash === '' || mod.sourceHash !== sourceHash) {
                        mod.sourceHash = sourceHash
                        shouldCompile = true
                    }
                } catch (err) {
                    throw new Error(`Download ${url}: ${err.message}`)
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
                    log.error(`module '${url}' not found`)
                    mod.error = err
                    return mod
                }
                throw err
            }
        }

        // check previous compile output
        if (!shouldCompile) {
            if (!bundleMode) {
                let jsFile = path.join(saveDir, name + (isRemote ? '' : `.${util.shortHash(mod.hash)}`) + '.js')
                if (existsFileSync(jsFile)) {
                    mod.jsFile = jsFile
                } else {
                    shouldCompile = true
                }
            } else {
                let bundlingFile = path.join(saveDir, `${name}.bundling.${util.shortHash(mod.sourceHash)}.js`)
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
            for (const plugin of this.config.plugins) {
                if (plugin.type === 'loader' && plugin.test.test(url)) {
                    const { code, format = 'js' } = await plugin.transform(sourceContent, url)
                    sourceCode = code
                    loader = format
                    mod.loader = format
                    break
                }
            }

            if (loader === 'css') {
                const css = await this.preprocessCSS(sourceCode)
                sourceCode = [
                    `import { applyCSS } from "${alephPkgUrl}/framework/${this.config.framework}/style.ts";`,
                    `export default function __applyCSS() {`,
                    `  applyCSS(${JSON.stringify(url)}, ${JSON.stringify(css)});`,
                    `}`,
                    bundleMode && `__ALEPH.pack[${JSON.stringify(url)}] = { default: __applyCSS };`
                ].filter(Boolean).join('\n')
                loader = 'js'
                // todo: css source map
            }

            if (loader !== 'js' && loader !== 'ts' && loader !== 'jsx' && loader !== 'tsx') {
                throw new Error(`Unknown loader '${path.extname(url).slice(1)}'`)
            }

            try {
                const t = performance.now()
                const swcOptions: SWCOptions = {
                    target: 'es2020',
                    sourceType: loader,
                    sourceMap: this.isDev,
                }
                const { code, map, deps, inlineStyles } = await this.transpile(sourceCode, {
                    url,
                    bundleMode,
                    bundledModules,
                    swcOptions,
                    importMap: this.importMap,
                    reactVersion: this.config.reactVersion,
                    isDev: this.isDev,
                })

                fsync = true
                jsContent = code
                if (map) {
                    jsSourceMap = map
                }

                // resolve inline-style
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
                    if (type !== 'css') {
                        for (const plugin of this.config.plugins) {
                            if (plugin.type === 'loader' && plugin.test.test(`${key}.${type}`)) {
                                const { code, format } = await plugin.transform((new TextEncoder).encode(tpl), url)
                                if (format === 'css') {
                                    tpl = code
                                    type = 'css'
                                    break
                                }
                            }
                        }
                    }
                    if (type === 'css') {
                        tpl = await this.preprocessCSS(tpl)
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
                    } else if (dep.url.startsWith('#inline-style-')) {
                        dep.isStyle = true
                        dep.hash = util.trimPrefix(dep.url, '#inline-style-')
                    }
                    return dep
                })

                log.debug(`compile '${url}' in ${Math.round(performance.now() - t)}ms ${bundleMode ? '(bundle mode)' : ''}`)
            } catch (e) {
                mod.error = new Error('transpile error')
                return mod
            }
        }

        // compile deps
        const deps = mod.deps.filter(({ url }) => {
            return !url.startsWith('#') && (!bundleMode || (!util.isLikelyHttpURL(url) && !bundledModules?.includes(url)))
        })
        for (const dep of deps) {
            const depMod = await this.compile(dep.url, { bundleMode, bundledModules })
            if (depMod.loader === 'css' && !dep.isStyle) {
                dep.isStyle = true
            }
            if (dep.hash === '' || dep.hash !== depMod.hash) {
                dep.hash = depMod.hash
                if (!util.isLikelyHttpURL(dep.url)) {
                    const depImportPath = getRelativePath(
                        path.dirname(url),
                        trimPageModuleExt(dep.url)
                    )
                    if (!shouldCompile) {
                        jsContent = await Deno.readTextFile(mod.jsFile)
                    }
                    jsContent = jsContent.replace(reHashResolve, (s, key, spaces, ql, importPath, qr) => {
                        if (importPath.replace(reHashJs, '') === depImportPath) {
                            if (!bundleMode) {
                                return `${key}${spaces}${ql}${depImportPath}.${util.shortHash(dep.hash)}.js${qr}`
                            } else {
                                return `${key}${spaces}${ql}${depImportPath}.bundling.${util.shortHash(depMod.sourceHash)}.js${qr}`
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
            if (!bundleMode) {
                mod.hash = (new Sha1).update(buildChecksum).update(jsContent).hex()
                mod.jsFile = path.join(saveDir, name + (isRemote ? '' : `.${util.shortHash(mod.hash)}`) + '.js')
                await cleanupCompilation(mod.jsFile)
                await Promise.all([
                    ensureTextFile(mod.jsFile, jsContent + (jsSourceMap ? '//# sourceMappingURL=' + path.basename(mod.jsFile) + '.map' : '')),
                    jsSourceMap ? ensureTextFile(mod.jsFile + '.map', jsSourceMap) : Promise.resolve(),
                    ensureTextFile(metaFile, JSON.stringify({
                        url,
                        sourceHash: mod.sourceHash,
                        hash: mod.hash,
                        deps: mod.deps,
                    }, undefined, 4)),
                ])
            } else {
                mod.bundlingFile = path.join(saveDir, `${name}.bundling.${util.shortHash(mod.sourceHash)}.js`)
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
    private updateHash(depUrl: string, depHash: string, callback: (mod: Module) => void) {
        this.#modules.forEach(mod => {
            for (const dep of mod.deps) {
                if (dep.url === depUrl) {
                    if (dep.hash !== depHash) {
                        dep.hash = depHash
                        if (mod.url === '/main.ts') {
                            this.createMainModule()
                        } else {
                            const depImportPath = getRelativePath(
                                path.dirname(mod.url),
                                trimPageModuleExt(dep.url)
                            )
                            Deno.readTextFile(mod.jsFile).then(jsContent => {
                                jsContent = jsContent.replace(reHashResolve, (s, key, spaces, ql, importPath, qr) => {
                                    if (importPath.replace(reHashJs, '') === depImportPath) {
                                        return `${key}${spaces}${ql}${depImportPath}.${util.shortHash(dep.hash)}.js${qr}`
                                    }
                                    return s
                                })
                                let prevSourceMap: string | null = null
                                if (existsFileSync(mod.jsFile + '.map')) {
                                    prevSourceMap = Deno.readTextFileSync(mod.jsFile + '.map')
                                }
                                mod.hash = (new Sha1).update(buildChecksum).update(jsContent).hex()
                                mod.jsFile = `${mod.jsFile.replace(reHashJs, '')}.${util.shortHash(mod.hash)}.js`
                                cleanupCompilation(mod.jsFile).then(() => {
                                    Promise.all([
                                        ensureTextFile(mod.jsFile.replace(reHashJs, '') + '.meta.json', JSON.stringify({
                                            url: mod.url,
                                            sourceHash: mod.sourceHash,
                                            hash: mod.hash,
                                            deps: mod.deps,
                                        }, undefined, 4)),
                                        ensureTextFile(mod.jsFile, jsContent),
                                        prevSourceMap ? ensureTextFile(mod.jsFile + '.map', prevSourceMap) : Promise.resolve()
                                    ])
                                })
                            })
                        }
                        callback(mod)
                        log.debug('update dependency:', mod.url, colors.dim('<-'), depUrl)
                        this.updateHash(mod.url, mod.hash, callback)
                    }
                    break
                }
            }
        })
    }

    /** load dependency content, use deno builtin cache system */
    private async loadDependency(url: string): Promise<Uint8Array> {
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
            stdout: 'piped',
            stderr: 'piped'
        })
        await Deno.stderr.write(await p.output())
        await Deno.stderr.write(await p.stderrOutput())
        p.close()

        if (existsFileSync(filename)) {
            return await Deno.readFile(filename)
        } else {
            throw new Error(`not found`)
        }
    }

    /** bundle modules for production. */
    private async bundle() {
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
            .filter(url => trimPageModuleExt(url) === '/app')
            .map(url => this.#modules.get(url))[0]
        const e404Module = Array.from(this.#modules.keys())
            .filter(url => trimPageModuleExt(url) === '/404')
            .map(url => this.#modules.get(url))[0]
        const pageModules: Module[] = []

        lookup('/main.ts')
        if (appModule) {
            await this.compile(appModule.url, { bundleMode: true })
            lookup(appModule.url)
        }
        if (e404Module) {
            await this.compile(e404Module.url, { bundleMode: true })
            lookup(e404Module.url)
        }
        this.#pageRouting.lookup(routes => routes.forEach(({ module: { url } }) => {
            const mod = this.getModule(url)
            if (mod) {
                lookup(url)
                mod.deps.forEach(dep => {
                    if (dep.isStyle) {
                        lookup(dep.url)
                    }
                })
                pageModules.push(mod)
            }
        }))

        const remoteDeps: string[] = []
        const localSharedDeps: string[] = []
        Array.from(refCounter.entries()).forEach(([url, count]) => {
            if (util.isLikelyHttpURL(url)) {
                remoteDeps.push(url)
            } else if (!url.startsWith('#') && !url.startsWith('/pages/') && count > 1) {
                localSharedDeps.push(url)
            }
        })
        if (appModule) {
            localSharedDeps.push(appModule.url)
        }
        if (e404Module) {
            localSharedDeps.push(e404Module.url)
        }

        log.info('- Bundle')
        await this.createChunkBundle('deps', remoteDeps)
        if (localSharedDeps.length > 0) {
            await this.createChunkBundle('shared', localSharedDeps)
        }

        // copy main module
        const mainModule = this.getModule('/main.ts')!
        const mainJSFile = path.join(this.outputDir, '_aleph', `main.${util.shortHash(mainModule.sourceHash)}.js`)
        const mainJSConent = await Deno.readTextFile(mainModule.bundlingFile)
        await Deno.writeTextFile(mainJSFile, mainJSConent)

        // create and copy polyfill
        const polyfillMode = this.newModule('/polyfill.js')
        const hash = (new Sha1).update(buildChecksum).update(AlephRuntimeCode).update(`${this.config.buildTarget}-${VERSION}`).hex()
        const polyfillFile = path.join(this.buildDir, `polyfill.${util.shortHash(hash)}.js`)
        if (!existsFileSync(polyfillFile)) {
            const rawPolyfillFile = `${alephPkgUrl}/compiler/polyfills/${this.config.buildTarget}/polyfill.js`
            await this.runDenoBundle(rawPolyfillFile, polyfillFile, AlephRuntimeCode, true)
        }
        await Deno.copyFile(polyfillFile, path.join(this.outputDir, '_aleph', `polyfill.${util.shortHash(hash)}.js`))

        polyfillMode.hash = polyfillMode.sourceHash = hash
        this.#modules.set(polyfillMode.url, polyfillMode)

        // bundle and copy page moudles
        await Promise.all(pageModules.map(async mod => this.createPageBundle(mod, localSharedDeps)))
    }

    /** create chunk bundle. */
    private async createChunkBundle(name: string, list: string[], header = '') {
        const imports = list.map((url, i) => {
            const mod = this.#modules.get(url)
            if (mod) {
                return [
                    `import * as ${name}_mod_${i} from ${JSON.stringify(util.isLikelyHttpURL(mod.url) ? mod.jsFile : mod.bundlingFile)}`,
                    `__ALEPH.pack[${JSON.stringify(url)}] = ${name}_mod_${i}`
                ]
            }
        }).flat().join('\n')
        const bundlingCode = imports
        const mod = this.newModule(`/${name}.bundling.js`)
        const hash = (new Sha1).update(buildChecksum).update(header).update(bundlingCode).hex()
        const bundlingFile = path.join(this.buildDir, mod.url)
        const bundleFile = path.join(this.buildDir, `${name}.bundle.${util.shortHash(hash)}.js`)
        const saveAs = path.join(this.outputDir, `_aleph/${name}.${util.shortHash(hash)}.js`)

        mod.hash = mod.sourceHash = hash

        if (existsFileSync(bundleFile)) {
            this.#modules.set(mod.url, mod)
            await Deno.rename(bundleFile, saveAs)
            return
        }

        await Deno.writeTextFile(bundlingFile, bundlingCode)
        const n = await this.runDenoBundle(bundlingFile, bundleFile, header)
        if (n > 0) {
            log.info(`  {} ${name}.js ${colors.dim('• ' + util.formatBytes(n))}`)
        }

        this.#modules.set(mod.url, mod)
        await Deno.rename(bundleFile, saveAs)
        Deno.remove(bundlingFile)
    }

    /** create page bundle. */
    private async createPageBundle(mod: Module, bundledModules: string[], header = '') {
        const { bundlingFile, hash } = await this.compile(mod.url, { bundleMode: true, bundledModules })
        const _tmp = util.trimSuffix(bundlingFile.replace(reHashJs, ''), '.bundling')
        const _bundlingFile = _tmp + `.bundling.js`
        const bundleFile = _tmp + `.bundle.${util.shortHash(hash)}.js`
        const saveAs = path.join(this.outputDir, `/_aleph/`, util.trimPrefix(_tmp, this.buildDir) + `.${util.shortHash(hash)}.js`)

        if (existsFileSync(bundleFile)) {
            await ensureDir(path.dirname(saveAs))
            await Deno.rename(bundleFile, saveAs)
            return
        }

        const bundlingCode = [
            `import * as mod from ${JSON.stringify(bundlingFile)}`,
            `__ALEPH.pack[${JSON.stringify(mod.url)}] = mod`
        ].join('\n')
        await Deno.writeTextFile(_bundlingFile, bundlingCode)
        await this.runDenoBundle(_bundlingFile, bundleFile, header)
        await ensureDir(path.dirname(saveAs))
        await Deno.rename(bundleFile, saveAs)
        Deno.remove(_bundlingFile)
    }

    /** run deno bundle and compess the output with terser. */
    private async runDenoBundle(bundlingFile: string, bundleFile: string, header = '', reload = false) {
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
        let { code } = await this.transpile(await Deno.readTextFile(bundleFile), {
            url: '/bundle.js',
            swcOptions: {
                target: this.config.buildTarget
            },
        })

        // workaround for https://github.com/denoland/deno/issues/9212
        if (Deno.version.deno === '1.7.0') {
            code = code.replace(' _ = l.baseState, ', ' var _ = l.baseState, ')
        }

        // IIFEify
        code = [
            '(() => {',
            header,
            code,
            '})()'
        ].join('\n')

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

        await cleanupCompilation(bundleFile)
        await Deno.writeTextFile(bundleFile, code)
        return code.length
    }

    /** optimize for production. */
    private async optimize() {
        // todo: optimize
    }

    /** render all pages in routing. */
    private async ssg() {
        const { ssr } = this.config
        const outputDir = this.outputDir

        if (!ssr) {
            const html = await this.getSPAIndexHtml()
            await ensureTextFile(path.join(outputDir, 'index.html'), html)
            await ensureTextFile(path.join(outputDir, '404.html'), html)
            return
        }

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
                    log.info('  ○', pathname, colors.dim('• ' + util.formatBytes(html.length)))
                } else if (status == 404) {
                    log.info('  ○', colors.dim(pathname), colors.red('Page not found'))
                } else if (status == 500) {
                    log.info('  ○', colors.dim(pathname), colors.red('Error 500'))
                }
            }
        }))

        // write 404 page
        const { url, head, scripts, body, data } = await this.render404Page()
        const e404PageHtml = createHtml({
            lang: url.locale,
            head: head,
            scripts: [
                data ? {
                    type: 'application/json',
                    innerText: JSON.stringify(data, undefined, this.isDev ? 4 : 0),
                    id: 'ssr-data'
                } : '',
                ...this.getScripts(),
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
    private async renderPage(loc: { pathname: string, search?: string }) {
        const start = performance.now()
        const [url, pageModuleChain] = this.#pageRouting.createRouter(loc)
        const key = [url.pathname, url.query.toString()].filter(Boolean).join('?')
        if (url.pagePath !== '') {
            if (this.#renderCache.has(url.pagePath)) {
                const cache = this.#renderCache.get(url.pagePath)!
                if (cache.has(key)) {
                    return cache.get(key)!
                }
            } else {
                this.#renderCache.set(url.pagePath, new Map())
            }
        }
        const ret: RenderResult = {
            url,
            status: url.pagePath === '' ? 404 : 200,
            head: [],
            scripts: [],
            body: '<div id="__aleph"></div>',
            data: null,
        }
        if (ret.status === 404) {
            if (this.isDev) {
                log.warn(`page '${url.pathname}' not found`)
            }
            return await this.render404Page(url)
        }
        try {
            const appModule = Array.from(this.#modules.values()).find(({ url }) => trimPageModuleExt(url) == '/app')
            const { default: App } = appModule ? await import('file://' + appModule.jsFile) : {} as any
            const imports = pageModuleChain.map(async ({ url }) => {
                const mod = this.#modules.get(url)!
                const { default: Component } = await import('file://' + mod.jsFile)
                return {
                    url,
                    Component
                }
            })
            const { head, body, data, scripts } = await this.#renderer.render(
                url,
                App,
                undefined,
                await Promise.all(imports),
                [
                    appModule ? this.lookupDeps(appModule.url).filter(dep => !!dep.isStyle) : [],
                    ...pageModuleChain.map(({ url }) => this.lookupDeps(url).filter(dep => !!dep.isStyle)).flat()
                ].flat()
            )
            ret.head = head
            ret.scripts = await Promise.all(scripts.map(async (script: Record<string, any>) => {
                if (script.innerText && !this.isDev) {
                    return { ...script, innerText: (await minify(script.innerText)).code }
                }
                return script
            }))
            ret.body = `<div id="__aleph">${body}</div>`
            ret.data = data
            this.#renderCache.get(url.pagePath)!.set(key, ret)
            log.info(`render '${url.pathname}' in ${Math.round(performance.now() - start)}ms`)
        } catch (err) {
            ret.status = 500
            ret.head = ['<title>Error 500 - Aleph.js</title>']
            ret.body = `<div id="__aleph"><pre>${colors.stripColor(err.stack)}</pre></div>`
            log.error(err)
        }
        return ret
    }

    /** check a page whether is ssrable. */
    private isSSRable(pathname: string): boolean {
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

    /** render custom 404 page. */
    private async render404Page(url: RouterURL = { locale: this.config.defaultLocale, pagePath: '', pathname: '/', params: {}, query: new URLSearchParams() }) {
        const ret: RenderResult = { url, status: 404, head: [], scripts: [], body: '<div id="__aleph"></div>', data: null }
        try {
            const e404Module = Array.from(this.#modules.keys())
                .filter(url => trimPageModuleExt(url) == '/404')
                .map(url => this.#modules.get(url))[0]
            const { default: E404 } = e404Module ? await import('file://' + e404Module.jsFile) : {} as any
            const { head, body, data, scripts } = await this.#renderer.render(
                url,
                undefined,
                E404,
                [],
                e404Module ? this.lookupDeps(e404Module.url).filter(dep => !!dep.isStyle) : []
            )
            ret.head = head
            ret.scripts = await Promise.all(scripts.map(async (script: Record<string, any>) => {
                if (script.innerText && !this.isDev) {
                    return { ...script, innerText: (await minify(script.innerText)).code }
                }
                return script
            }))
            ret.body = `<div id="__aleph">${body}</div>`
            ret.data = data
        } catch (err) {
            ret.status = 500
            ret.head = ['<title>Error 500 - Aleph.js</title>']
            ret.body = `<div id="__aleph"><pre>${colors.stripColor(err.stack)}</pre></div>`
            log.error(err)
        }
        return ret
    }

    /** render custom loading page for SPA mode. */
    private async renderLoadingPage() {
        const loadingModule = Array.from(this.#modules.keys())
            .filter(url => trimPageModuleExt(url) == '/loading')
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
            } = await this.#renderer.render(
                router,
                undefined,
                undefined,
                [{ url: loadingModule.url, Component: Loading }],
                this.lookupDeps(loadingModule.url).filter(dep => !!dep.isStyle)
            )
            return {
                head,
                body: `<div id="__aleph">${body}</div>`
            } as Pick<RenderResult, 'head' | 'body'>
        }
        return null
    }

    /** lookup deps recurively. */
    private lookupDeps(url: string, __deps: DependencyDescriptor[] = [], __tracing: Set<string> = new Set()) {
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
            if (isPageModule(url) && !util.isLikelyHttpURL(url)) {
                this.lookupDeps(url, __deps, __tracing)
            }
        })
        return __deps
    }
}
