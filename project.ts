import { minify } from 'https://esm.sh/terser'
import { EventEmitter } from './events.ts'
import { createHtml } from './html.ts'
import log from './log.ts'
import { createRouter } from './router.ts'
import { colors, ensureDir, path, Sha1, walk } from './std.ts'
import { compile } from './tsc/compile.ts'
import type { AlephEnv, APIHandle, Config, Location, RouterURL } from './types.ts'
import util, { existsDirSync, existsFileSync, hashShort, reHashJs, reHttp, reModuleExt, reStyleModuleExt } from './util.ts'
import { cleanCSS, Document, less } from './vendor/mod.ts'
import { version } from './version.ts'

interface Dep {
    url: string
    hash: string
    async?: boolean
}

interface Module {
    id: string
    url: string
    isRemote: boolean
    deps: Dep[]
    sourceFilePath: string
    sourceType: string
    sourceHash: string
    jsFile: string
    jsContent: string
    jsSourceMap: string
    hash: string
}

interface RenderResult {
    code: number
    head: string[]
    body: string
}

export default class Project {
    readonly mode: 'development' | 'production'
    readonly appRoot: string
    readonly config: Config
    readonly ready: Promise<void>

    #buildID: string = ''
    #modules: Map<string, Module> = new Map()
    #pageModules: Map<string, { moduleID: string, rendered: Map<string, RenderResult> }> = new Map()
    #fsWatchListeners: Array<EventEmitter> = []

    constructor(dir: string, mode: 'development' | 'production') {
        this.mode = mode
        this.appRoot = dir
        this.config = {
            srcDir: '/',
            outputDir: '/dist',
            baseUrl: '/',
            defaultLocale: 'en',
            ssr: {
                fallback: '404.html'
            },
            buildTarget: mode === 'development' ? 'es2018' : 'es2015',
            sourceMap: false,
            importMap: {
                imports: {}
            }
        }
        this.ready = (async () => {
            const t = performance.now()
            await this._loadConfig()
            await this._init()
            log.debug('initialize project token ' + Math.round(performance.now() - t) + 'ms')
        })()
    }

    get isDev() {
        return this.mode === 'development'
    }

    get srcDir() {
        return path.join(this.appRoot, this.config.srcDir)
    }

    get buildID() {
        return this.#buildID
    }

    get buildDir() {
        return path.join(this.appRoot, '.aleph', 'build-' + this.buildID)
    }

    get apiPaths() {
        return Array.from(this.#modules.keys())
            .filter(p => p.startsWith('/api/'))
            .map(p => p.slice(1).replace(reModuleExt, ''))
    }

    isHMRable(moduleID: string) {
        return !reHttp.test(moduleID) && (
            moduleID === '/404.js' ||
            moduleID === '/app.js' ||
            moduleID === '/data.js' ||
            (moduleID === '/data/index.js' && !this.#modules.has('/data.js')) ||
            moduleID.startsWith('/pages/') ||
            moduleID.startsWith('/components/') ||
            reStyleModuleExt.test(moduleID)
        )
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
        } else {
            if (reHashJs.test(modId)) {
                const id = modId.slice(0, modId.length - (hashShort + 4))
                if (reStyleModuleExt.test(id)) {
                    modId = id
                } else {
                    modId = id + '.js'
                }
            }
        }
        if (!this.#modules.has(modId) && modId == '/data.js') {
            modId = '/data/index.js'
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

    async getAPIHandle(path: string): Promise<APIHandle | null> {
        if (path) {
            const importPath = '.' + path + '.js'
            if (this.#modules.has(importPath)) {
                try {
                    const { default: handle } = await import("file://" + this.#modules.get(importPath)!.jsFile)
                    return handle
                } catch (error) {
                    log.error(error)
                }
            }
        }
        return null
    }

    async getPageHtml(location: Location): Promise<[number, string]> {
        const { baseUrl, defaultLocale } = this.config
        const url = createRouter(
            baseUrl,
            Array.from(this.#pageModules.keys()),
            {
                location,
                defaultLocale
            }
        )

        if (url.pagePath === '') {
            return [200, this.getDefaultIndexHtml()]
        }

        const mainModule = this.#modules.get('/main.js')!
        const { code, head, body } = await this._renderPage(url)
        const html = createHtml({
            lang: url.locale,
            head: head,
            scripts: [
                { type: 'application/json', id: 'ssr-data', innerText: JSON.stringify({ url }) },
                { src: path.join(baseUrl, `/_aleph/main.${mainModule.hash.slice(0, hashShort)}.js`), type: 'module' },
            ],
            body,
            minify: !this.isDev
        })
        return [code, html]
    }

    getDefaultIndexHtml(): string {
        const { baseUrl, defaultLocale } = this.config
        const mainModule = this.#modules.get('/main.js')!
        const html = createHtml({
            lang: defaultLocale,
            scripts: [
                { src: path.join(baseUrl, `/_aleph/main.${mainModule.hash.slice(0, hashShort)}.js`), type: 'module' },
            ],
            body: `<main></main>`,
            minify: !this.isDev
        })
        return html
    }

    async getData() {
        const mod = this.#modules.get('/data.js') || this.#modules.get('/data/index.js')
        if (mod) {
            try {
                const { default: Data } = await import("file://" + mod.jsFile)
                let data: any = Data
                if (util.isFunction(Data)) {
                    data = await Data()
                }
                if (util.isPlainObject(data)) {
                    return data
                } else {
                    log.warn(`module '${mod.url}' should return a plain object as default`)
                }
            } catch (error) {
                log.error(error)
            }
        }
        return {}
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

        // wait project ready
        await this.ready

        // lookup output modules
        lookup('/main.js')

        // ensure ouput directory ready
        if (existsDirSync(outputDir)) {
            await Deno.remove(outputDir, { recursive: true })
        }
        await Promise.all([outputDir, distDir].map(dir => ensureDir(dir)))

        // copy public files
        const publicDir = path.join(this.appRoot, 'public')
        if (existsDirSync(publicDir)) {
            for await (const { path: p } of walk(publicDir, { includeDirs: false })) {
                await Deno.copyFile(p, path.join(outputDir, util.trimPrefix(p, publicDir)))
            }
        }

        // write modules
        const { sourceMap } = this.config
        await Promise.all(Array.from(outputModules).map((moduleID) => {
            const { sourceFilePath, isRemote, jsContent, jsSourceMap, hash } = this.#modules.get(moduleID)!
            const saveDir = path.join(distDir, path.dirname(sourceFilePath))
            const name = path.basename(sourceFilePath).replace(reModuleExt, '')
            const jsFile = path.join(saveDir, name + (isRemote ? '' : '.' + hash.slice(0, hashShort))) + '.js'
            return Promise.all([
                writeTextFile(jsFile, jsContent),
                sourceMap ? writeTextFile(jsFile + '.map', jsSourceMap) : Promise.resolve(),
            ])
        }))

        // write static data
        if (this.#modules.has('/data.js') || this.#modules.has('/data/index.js')) {
            const { hash } = this.#modules.get('/data.js') || this.#modules.get('/data/index.js')!
            const data = this.getData()
            await writeTextFile(path.join(distDir, `data.${hash.slice(0, hashShort)}.js`), `export default ${JSON.stringify(data)}`)
        }

        const { ssr } = this.config
        if (ssr) {
            for (const pathname of this.#pageModules.keys()) {
                const [_, html] = await this.getPageHtml({ pathname })
                const htmlFile = path.join(outputDir, pathname, 'index.html')
                await writeTextFile(htmlFile, html)
            }
            const fbHtmlFile = path.join(outputDir, util.isPlainObject(ssr) && ssr.fallback ? ssr.fallback : '404.html')
            await writeTextFile(fbHtmlFile, this.getDefaultIndexHtml())
        } else {
            await writeTextFile(path.join(outputDir, 'index.html'), this.getDefaultIndexHtml())
        }

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
                if (name.endsWith('.json')) {
                    try {
                        const conf = JSON.parse(await Deno.readTextFile(p))
                        Object.assign(config, conf)
                        log.debug(name, config)
                    } catch (e) {
                        log.fatal('parse config.json:', e.message)
                    }
                } else {
                    const { default: conf } = await import("file://" + p)
                    if (util.isPlainObject(conf)) {
                        Object.assign(config, conf)
                        log.debug(name, config)
                    }
                }
            }
        }

        const {
            srcDir,
            ouputDir,
            baseUrl,
            ssr,
            buildTarget,
            sourceMap,
            defaultLocale
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
        if (util.isNEString(defaultLocale)) {
            Object.assign(this.config, { defaultLocale })
        }
        if (typeof ssr === 'boolean') {
            Object.assign(this.config, { ssr })
        } else if (util.isPlainObject(ssr)) {
            const fallback = util.isNEString(ssr.fallback) ? util.ensureExt(ssr.fallback, '.html') : '404.html'
            const include = util.isArray(ssr.include) ? ssr.include : []
            const exclude = util.isArray(ssr.exclude) ? ssr.exclude : []
            Object.assign(this.config, { ssr: { fallback, include, exclude } })
        }
        if (/^es(20\d{2}|next)$/i.test(buildTarget)) {
            Object.assign(this.config, { buildTarget: buildTarget.toLowerCase() })
        }
        if (typeof sourceMap === 'boolean') {
            Object.assign(this.config, { sourceMap })
        }

        // Gen build ID after config loaded
        this.#buildID = (new Sha1()).update(this.mode + '.' + this.config.buildTarget + '.' + version).hex().slice(0, 18)
    }

    private async _init() {
        const walkOptions = { includeDirs: false, exts: ['.js', '.ts', '.mjs'], skip: [/^\./, /\.d\.ts$/i, /\.(test|spec|e2e)\.m?(j|t)s$/i] }
        const dataDir = path.join(this.srcDir, 'data')
        const apiDir = path.join(this.srcDir, 'api')
        const pagesDir = path.join(this.srcDir, 'pages')

        if (!(existsDirSync(pagesDir))) {
            log.fatal(`'pages' directory not found.`)
        }

        Object.assign(globalThis, {
            ALEPH_ENV: {
                appRoot: this.appRoot,
                buildID: this.buildID,
                config: this.config,
                mode: this.mode,
            } as AlephEnv,
            document: new Document(),
            innerWidth: 1920,
            innerHeight: 1080,
            devicePixelRatio: 1,
            $RefreshReg$: () => { },
            $RefreshSig$: () => (type: any) => type,
        })

        for await (const { path: p, isDirectory, isFile } of walk(this.srcDir, { maxDepth: 1 })) {
            const name = path.basename(p)
            if (isDirectory && p !== this.srcDir) {
                switch (name) {
                    case 'api':
                        for await (const { path: p } of walk(apiDir, walkOptions)) {
                            await this._compile('/api' + util.trimPrefix(p, apiDir))
                        }
                        break
                    case 'data':
                        for await (const { path: p } of walk(dataDir, { ...walkOptions, maxDepth: 1 })) {
                            const name = path.basename(p)
                            if (name.replace(reModuleExt, '') === 'index') {
                                await this._compile('/data/' + name)
                            }
                        }
                        break
                }
            } else if (isFile && reModuleExt.test(name)) {
                switch (name.replace(reModuleExt, '')) {
                    case 'app':
                    case 'data':
                    case '404':
                        await this._compile('/' + name)
                        break
                }
            }
        }

        for await (const { path: p } of walk(pagesDir, { ...walkOptions, exts: [...walkOptions.exts, '.jsx', '.tsx', '.md', '.mdx'] })) {
            const rp = util.trimPrefix(p, pagesDir)
            const pagePath = rp.replace(reModuleExt, '').replace(/\s+/g, '-').replace(/\/index$/i, '') || '/'
            const mod = await this._compile('/pages' + rp)
            this.#pageModules.set(pagePath, {
                moduleID: mod.id,
                rendered: new Map()
            })
        }

        const precompileUrls = [
            'https://deno.land/x/aleph/bootstrap.ts',
            'https://deno.land/x/aleph/renderer.ts',
            'https://deno.land/x/aleph/tsc/tslib.js',
        ]
        if (this.isDev) {
            precompileUrls.push('https://deno.land/x/aleph/hmr.ts')
        }
        for (const url of precompileUrls) {
            await this._compile(url)
        }
        await this._createMainModule()

        log.info(colors.bold('Pages'))
        for (const path of this.#pageModules.keys()) {
            const isIndex = path == '/'
            log.info('○', path, isIndex ? colors.dim('(index)') : '')
        }
        for (const path of this.apiPaths) {
            log.info('λ', path)
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
                const path = util.trimPrefix(util.trimPrefix(p, this.appRoot), '/')
                const validated = (() => {
                    if (!reModuleExt.test(path) && !reStyleModuleExt.test(path)) {
                        return false
                    }
                    // ignore '.aleph' and output directories
                    if (path.startsWith('.aleph/') || path.startsWith(this.config.outputDir.slice(1))) {
                        return false
                    }
                    const moduleID = '/' + path.replace(reModuleExt, '.js')
                    switch (moduleID) {
                        case '/404.js':
                        case '/app.js':
                        case '/data.js':
                        case '/data/index.js': {
                            return true
                        }
                        default: {
                            if ((moduleID.startsWith('/pages/') || moduleID.startsWith('/api/')) && moduleID.endsWith('.js')) {
                                return true
                            }
                            let isDep = false
                            for (const { deps } of this.#modules.values()) {
                                if (deps.findIndex(dep => dep.url === '/' + path) > -1) {
                                    isDep = true
                                    break
                                }
                            }
                            return isDep
                        }
                    }
                })()
                if (validated) {
                    const moduleID = '/' + path.replace(reModuleExt, '.js')
                    util.debounceX(moduleID, () => {
                        const removed = !existsFileSync(p)
                        const cleanup = () => {
                            if (moduleID === '/app.js' || moduleID === '/data.js' || moduleID === '/data/index.js') {
                                this._clearPageRenderCache()
                            } else if (moduleID.startsWith('/pages/')) {
                                if (removed) {
                                    this._removePageModuleById(moduleID)
                                } else {
                                    if (this.#pageModules.has(moduleID)) {
                                        this._clearPageRenderCache(moduleID)
                                    } else {
                                        const pagePath = util.trimPrefix(moduleID, '/pages').replace(reModuleExt, '').replace(/\s+/g, '-').replace(/\/index$/i, '') || '/'
                                        this.#pageModules.set(pagePath, { moduleID, rendered: new Map() })
                                    }
                                }
                            }
                            this._createMainModule()
                        }
                        if (!removed) {
                            let type = 'modify'
                            if (!this.#modules.has(moduleID)) {
                                type = 'add'
                            }
                            log.info(type, '/' + path)
                            this._compile('/' + path, { forceCompile: true }).then(({ hash }) => {
                                const hmrable = this.isHMRable(moduleID)
                                if (hmrable) {
                                    if (type === 'add') {
                                        this.#fsWatchListeners.forEach(e => e.emit('add', moduleID, hash))
                                    } else {
                                        this.#fsWatchListeners.forEach(e => e.emit('modify-' + moduleID, hash))
                                    }
                                }
                                cleanup()
                                this._updateDependency('/' + path, hash, mod => {
                                    if (!hmrable && this.isHMRable(mod.id)) {
                                        this.#fsWatchListeners.forEach(e => e.emit(mod.id, 'modify', mod.hash))
                                    }
                                    if (mod.id.startsWith('/pages/')) {
                                        this._clearPageRenderCache(mod.id)
                                    }
                                })
                            }).catch(err => {
                                log.error(`compile(/${path}):`, err.message)
                            })
                        } else if (this.#modules.has(moduleID)) {
                            this.#modules.delete(moduleID)
                            cleanup()
                            if (this.isHMRable(moduleID)) {
                                this.#fsWatchListeners.forEach(e => e.emit('remove', moduleID))
                            }
                            log.info('remove', '/' + path)
                        }
                    }, 150)
                }
            }
        }
    }

    private _removePageModuleById(moduleID: string) {
        let pagePath = ''
        for (const [p, pm] of this.#pageModules.entries()) {
            if (pm.moduleID === moduleID) {
                pagePath = p
                break
            }
        }
        if (pagePath !== '') {
            this.#pageModules.delete(pagePath)
        }
    }

    private _clearPageRenderCache(moduleID?: string) {
        for (const [_, p] of this.#pageModules.entries()) {
            if (!moduleID) {
                p.rendered.clear()
            } else if (p.moduleID == moduleID) {
                p.rendered.clear()
                break
            }
        }
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
            locales: {},
            coreModules: {},
            pageModules: {}
        }
        const module = this._moduleFromURL('/main.js')
        const deps = [
            this.isDev && 'https://deno.land/x/aleph/hmr.ts',
            'https://deno.land/x/aleph/bootstrap.ts'
        ].filter(Boolean).map(url => ({
            url: String(url),
            hash: this.#modules.get(String(url).replace(reHttp, '//').replace(reModuleExt, '.js'))?.hash || ''
        }))
        if (this.#modules.has('/data.js') || this.#modules.has('/data/index.js')) {
            const { id, url, hash } = this.#modules.get('/data.js') || this.#modules.get('/data/index.js')!
            config.coreModules.data = { id, hash }
            deps.push({ url, hash })
        }
        if (this.#modules.has('/app.js')) {
            const { url, hash } = this.#modules.get('/app.js')!
            config.coreModules.app = { id: '/app.js', hash }
            deps.push({ url, hash })
        }
        if (this.#modules.has('/404.js')) {
            const { url, hash } = this.#modules.get('/404.js')!
            config.coreModules['404'] = { id: '/404.js', hash }
            deps.push({ url, hash })
        }
        this.#pageModules.forEach(({ moduleID }, pagePath) => {
            const { url, hash } = this.#modules.get(moduleID)!
            config.pageModules[pagePath] = { id: moduleID, hash }
            deps.push({ url, hash })
        })

        for (const key in config.coreModules) {
            const m = config.coreModules[key]
            m.asyncDeps = this._lookupStyleDeps(m.id).filter(({ async }) => !!async).map(({ url, hash }) => ({ url, hash }))
        }

        for (const key in config.pageModules) {
            const m = config.pageModules[key]
            m.asyncDeps = this._lookupStyleDeps(m.id).filter(({ async }) => !!async).map(({ url, hash }) => ({ url, hash }))
        }

        module.jsContent = [
            this.isDev && 'import "./-/deno.land/x/aleph/hmr.js";',
            'import bootstrap from "./-/deno.land/x/aleph/bootstrap.js";',
            `bootstrap(${JSON.stringify(config, undefined, this.isDev ? 4 : undefined)});`
        ].filter(Boolean).join(this.isDev ? '\n' : '')
        module.hash = (new Sha1()).update(module.jsContent).hex()
        module.jsFile = path.join(this.buildDir, `main.${module.hash.slice(0, hashShort)}.js`)
        module.deps = deps

        await Promise.all([
            writeTextFile(module.jsFile, module.jsContent),
            writeTextFile(path.join(this.buildDir, 'main.meta.json'), JSON.stringify({
                url: '/main.js',
                sourceHash: module.hash,
                hash: module.hash,
                deps: module.deps,
            }, undefined, 4))
        ])
        this.#modules.set(module.id, module)

        return module
    }

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
            const sourceHash = (new Sha1()).update(options.sourceCode).hex()
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
                        throw new Error(`${resp.status} - ${resp.statusText}`)
                    }
                    if (mod.sourceType === 'js') {
                        const t = resp.headers.get('Content-Type')
                        if (t?.startsWith('text/typescript')) {
                            mod.sourceType = 'ts'
                        } else if (t?.startsWith('text/jsx')) {
                            mod.sourceType = 'jsx'
                        }
                    }
                    mod.sourceHash = (new Sha1()).update(sourceContent).hex()
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
                    const sourceHash = (new Sha1()).update(text).hex()
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
            const sourceHash = (new Sha1()).update(text).hex()
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
                const hash = (new Sha1).update(css).hex()
                const filepath = path.join(
                    path.dirname(mod.sourceFilePath),
                    util.trimSuffix(path.basename(mod.sourceFilePath), '.css') + '.' + hash.slice(0, hashShort) + '.css'
                )
                const asLink = css.length > 1024
                if (asLink) {
                    await writeTextFile(path.join(this.buildDir, filepath), css)
                }
                mod.jsContent = [
                    `import { applyCSS } from ${JSON.stringify(relativePath(
                        path.dirname(mod.url),
                        '/-/deno.land/x/aleph/head.js'
                    ))};`,
                    `applyCSS(${JSON.stringify(url)}, ${asLink ? JSON.stringify(path.join(this.config.baseUrl, '_aleph', filepath)) + ', true' : JSON.stringify(this.isDev ? `\n${css}\n` : css)});`,
                ].join(this.isDev ? '\n' : '')
                mod.jsSourceMap = ''
                mod.hash = hash
            } else if (mod.sourceType === 'md' || mod.sourceType === 'mdx') {
                mod.jsContent = `export default function MD() { return React.createElement('pre', null, ${JSON.stringify(sourceContent)})}`
                mod.jsSourceMap = ''
                mod.hash = mod.sourceHash
            } else {
                const compileOptions = {
                    target: this.config.buildTarget,
                    mode: this.mode,
                    reactRefresh: this.isDev && !mod.isRemote && (mod.id === '/404.js' || mod.id === '/app.js' || mod.id.startsWith('/pages/') || mod.id.startsWith('/components/')),
                    rewriteImportPath: (path: string, async?: boolean) => this._rewriteImportPath(mod, path, async),
                }
                const { diagnostics, outputText, sourceMapText } = compile(mod.sourceFilePath, sourceContent, compileOptions)
                if (diagnostics && diagnostics.length > 0) {
                    throw new Error(`compile ${url}: ${diagnostics.map(d => d.messageText).join(' ')}`)
                }
                const jsContent = outputText.replace(/import([^'"]*)("|')tslib("|')(\)|;)?/g, 'import$1' + JSON.stringify(relativePath(
                    path.dirname(mod.sourceFilePath),
                    '/-/deno.land/x/aleph/tsc/tslib.js'
                )) + '$4')
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
                mod.hash = (new Sha1).update(mod.jsContent).hex()
            }

            log.debug(`${url} compiled in ${(performance.now() - t).toFixed(3)}ms`)

            if (!fsync) {
                fsync = true
            }
        }

        this.#modules.set(mod.id, mod)

        // compile deps
        for (const dep of mod.deps) {
            const depMod = await this._compile(dep.url)
            if (dep.hash !== depMod.hash) {
                dep.hash = depMod.hash
                if (!reHttp.test(dep.url)) {
                    const depImportPath = relativePath(
                        path.dirname(url),
                        dep.url.replace(reModuleExt, '')
                    )
                    mod.jsContent = mod.jsContent.replace(/(import|Import|export)([^'"]*)("|')([^'"]+)("|')(\)|;)?/g, (s, key, from, ql, importPath, qr, end) => {
                        if (
                            reHashJs.test(importPath) &&
                            importPath.slice(0, importPath.length - (hashShort + 4)) === depImportPath
                        ) {
                            return `${key}${from}${ql}${depImportPath}.${dep.hash.slice(0, hashShort)}.js${qr}${end || ''}`
                        }
                        return s
                    })
                    mod.hash = (new Sha1).update(mod.jsContent).hex()
                }
                if (!fsync) {
                    fsync = true
                }
            }
        }

        if (fsync) {
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

    private _updateDependency(depPath: string, depHash: string, callback: (mod: Module) => void, trace?: Set<string>) {
        trace = trace || new Set()
        this.#modules.forEach(mod => {
            mod.deps.forEach(dep => {
                if (dep.url === depPath && dep.hash !== depHash && !trace?.has(mod.id)) {
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
                        mod.hash = (new Sha1).update(mod.jsContent).hex()
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
                    trace?.add(mod.id)
                    this._updateDependency(mod.url, mod.hash, callback, trace)
                    log.debug('update dependency:', depPath, '->', mod.url)
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

    private async _renderPage(url: RouterURL) {
        const start = performance.now()
        const ret: RenderResult = { code: 200, head: [], body: '<main></main>' }
        const page = this.#pageModules.get(url.pagePath)!
        if (page.rendered.has(url.pathname)) {
            const cache = page.rendered.get(url.pathname)!
            return { ...cache }
        }
        Object.assign(window, {
            location: {
                protocol: 'http:',
                host: 'localhost',
                hostname: 'localhost',
                port: '',
                href: 'http://localhost' + url.pathname,
                origin: 'http://localhost',
                pathname: url.pathname,
                search: '',
                hash: '',
                reload() { },
                replace() { },
                toString() { return this.href },
            }
        })
        try {
            const appModule = this.#modules.get('/app.js')
            const pageModule = this.#modules.get(page.moduleID)!
            const { renderPage, renderHead } = await import("file://" + this.#modules.get('//deno.land/x/aleph/renderer.js')!.jsFile)
            const { default: App } = appModule ? await import("file://" + appModule.jsFile) : {} as any
            const { default: Page } = await import("file://" + pageModule.jsFile)
            const data = await this.getData()
            const html = renderPage(data, url, appModule ? App : undefined, Page)
            const head = await renderHead([
                appModule ? this._lookupStyleDeps(appModule.id) : [],
                this._lookupStyleDeps(pageModule.id),
            ].flat())
            ret.code = 200
            ret.head = head
            ret.body = `<main>${html}</main>`
            page.rendered.set(url.pathname, { ...ret })
            log.debug(`render page '${url.pagePath}' in ${Math.round(performance.now() - start)}ms`)
        } catch (err) {
            ret.code = 500
            ret.head = ['<title>500 Error - Aleph.js</title>']
            ret.body = `<main><pre>${err.stack}</pre></main>`
            log.error(err.stack)
        }
        return ret
    }

    private _lookupStyleDeps(moduleID: string, a: Dep[] = [], s: Set<string> = new Set()) {
        const mod = this.getModule(moduleID)
        if (!mod) {
            return a
        }
        if (s.has(moduleID)) {
            return a
        }
        s.add(moduleID)
        a.push(...mod.deps.filter(({ url }) => reStyleModuleExt.test(url)))
        mod.deps.forEach(({ url }) => {
            if (reModuleExt.test(url) && !reHttp.test(url)) {
                this._lookupStyleDeps(url.replace(reModuleExt, '.js'), a, s)
            }
        })
        return a
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
    const reactRefresh = id.endsWith('.js')
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

async function writeTextFile(filepath: string, content: string) {
    const dir = path.dirname(filepath)
    await ensureDir(dir)
    await Deno.writeTextFile(filepath, content)
}
