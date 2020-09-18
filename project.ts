import type { APIHandle, Location, RouterURL } from './api.ts'
import { AnsiUp, colors, ensureDir, less, minify, path, Sha1, walk } from './deps.ts'
import { EventEmitter } from './events.ts'
import { createHtml } from './html.ts'
import log from './log.ts'
import route from './route.ts'
import { compile } from './tsc/compile.ts'
import util, { hashShort } from './util.ts'

const reHttp = /^https?:\/\//i
const reModuleExt = /\.(js|jsx|mjs|ts|tsx)$/i
const reStyleModuleExt = /\.(css|less|sass|scss)$/i
const reHashJs = new RegExp(`\\.[0-9a-fx]{${hashShort}}\\.js$`, 'i')

const { CleanCSS } = window as any
const cleanCSS = new CleanCSS({ compatibility: '*' /* Internet Explorer 10+ */ })

interface Config {
    readonly rootDir: string
    readonly srcDir: string
    readonly outputDir: string
    readonly baseUrl: string
    readonly defaultLocale: string
    readonly cacheDeps: boolean
    readonly target: string
    readonly importMap: {
        imports: Record<string, string>
    }
}

interface Module {
    id: string
    url: string
    isRemote: boolean
    deps: { url: string, hash: string }[]
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
    readonly config: Config
    readonly ready: Promise<void>

    #modules: Map<string, Module> = new Map()
    #pageModules: Map<string, { moduleId: string, rendered: Map<string, RenderResult> }> = new Map()
    #fsWatchListeners: Array<EventEmitter> = []

    constructor(dir: string, mode: 'development' | 'production') {
        this.mode = mode
        this.config = {
            rootDir: path.resolve(dir),
            srcDir: '/',
            outputDir: '/out',
            cacheDeps: true,
            baseUrl: '/',
            defaultLocale: 'en',
            target: 'ES2015',
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

    get rootDir() {
        return this.config.rootDir
    }

    get srcDir() {
        const { rootDir, srcDir } = this.config
        return path.join(rootDir, srcDir)
    }

    get apiPaths() {
        return Array.from(this.#modules.keys())
            .filter(p => p.startsWith('./api/'))
            .map(p => p.slice(1).replace(reModuleExt, ''))
    }

    isHMRable(moduleId: string) {
        if (reHttp.test(moduleId)) {
            return false
        }
        return moduleId === './app.js' || moduleId === './data.js' || moduleId === './data/index.js' || moduleId.startsWith('./pages/') || moduleId.startsWith('./components/') || reStyleModuleExt.test(moduleId)
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
        if (modId.startsWith('/_dist/')) {
            modId = util.trimPrefix(modId, '/_dist')
        }
        if (modId.startsWith('/-/')) {
            modId = '//' + util.trimSuffix(util.trimPrefix(modId, '/-/'), '.js')
            if (!reStyleModuleExt.test(modId)) {
                modId = modId + '.js'
            }
        } else {
            modId = '.' + modId
            if (reHashJs.test(modId)) {
                const id = modId.slice(0, modId.length - (hashShort + 4))
                if (reStyleModuleExt.test(id)) {
                    modId = id
                } else {
                    modId = id + '.js'
                }
            }
        }
        if (!this.#modules.has(modId) && modId == './data.js') {
            modId = './data/index.js'
        }
        if (!this.#modules.has(modId)) {
            console.warn(`can't get the module by path '${pathname}(${modId})'`)
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
                const { default: handle } = await import(this.#modules.get(importPath)!.jsFile)
                return handle
            }
        }
        return null
    }

    async getPageHtml(location: Location): Promise<[number, string]> {
        const { baseUrl, defaultLocale } = this.config
        const url = route(
            baseUrl,
            Array.from(this.#pageModules.keys()),
            {
                location,
                defaultLocale,
                fallback: '/404'
            }
        )
        const mainMod = this.#modules.get('./main.js')!
        const { code, head, body } = await this._renderPage(url)
        const html = createHtml({
            lang: url.locale,
            head: head,
            scripts: [
                { type: 'application/json', id: 'ssr-data', innerText: JSON.stringify({ url }) },
                { src: path.join(baseUrl, `/_dist/main.${mainMod.hash.slice(0, hashShort)}.js`), type: 'module' },
            ],
            body,
            minify: !this.isDev
        })
        return [code, html]
    }

    async getData() {
        const mod = this.#modules.get('./data.js') || this.#modules.get('./data/index.js')
        if (mod) {
            const { default: Data } = await import(mod.jsFile)
            let data: any = Data
            if (util.isFunction(Data)) {
                data = await Data()
            }
            if (util.isPlainObject(data)) {
                return data
            } else {
                log.warn(`module '${mod.url}' should return a plain object`)
            }
        }
        return {}
    }

    async importModuleAsComponent(moduleId: string) {
        if (this.#modules.has(moduleId)) {
            const { default: Component } = await import(this.#modules.get(moduleId)!.jsFile)
            if (util.isLikelyReactComponent(Component)) {
                return { Component }
            }
        }
        return {}
    }

    async build() {
        const start = performance.now()
        const outputDir = path.join(this.srcDir, this.config.outputDir)
        const publicDir = path.join(this.srcDir, 'public')
        const distDir = path.join(outputDir, '_dist')
        await this.ready
        if (util.existsDir(outputDir)) {
            await Deno.remove(outputDir, { recursive: true })
        }
        await Promise.all([outputDir, distDir].map(dir => ensureDir(dir)))
        await Promise.all(Array.from(this.#modules.values())
            .filter(({ id }) => {
                switch (id) {
                    case 'deno.land/x/aleph/renderer.js':
                    case 'deno.land/x/aleph/vendor/react-dom-server/server.js':
                        return false
                    default:
                        return !id.startsWith('./api/')
                }
            })
            .map(({ sourceFilePath, isRemote, jsContent, hash }) => {
                const saveDir = path.join(distDir, sourceFilePath)
                const name = path.basename(sourceFilePath).replace(reModuleExt, '')
                const jsFile = path.join(saveDir, name + (isRemote ? '' : '.' + hash.slice(0, hashShort))) + '.js'
                return writeTextFile(jsFile, jsContent)
            }))
        for (const pathname of this.#pageModules.keys()) {
            const [_, html] = await this.getPageHtml({ pathname })
            const htmlFile = path.join(outputDir, pathname, 'index.html')
            await writeTextFile(htmlFile, html)
        }
        if (util.existsDir(publicDir)) {
            for await (const { path: p } of walk(publicDir, { includeDirs: false })) {
                const rp = path.resolve(util.trimPrefix(p, publicDir))
                await Deno.copyFile(p, path.join(outputDir, rp))
            }
        }
        log.info(`Done in ${Math.round(performance.now() - start)}ms`)
    }

    private async _loadConfig() {
        const { ALEPH_IMPORT_MAP } = globalThis as any
        if (ALEPH_IMPORT_MAP) {
            const { imports } = ALEPH_IMPORT_MAP
            Object.assign(this.config.importMap, { imports: Object.assign({}, this.config.importMap.imports, imports) })
        }

        const importMapFile = path.join(this.config.rootDir, 'import_map.json')
        if (util.existsFile(importMapFile)) {
            const { imports } = JSON.parse(await Deno.readTextFile(importMapFile))
            Object.assign(this.config.importMap, { imports: Object.assign({}, this.config.importMap.imports, imports) })
        }

        const configFile = path.join(this.config.rootDir, 'post.config.json')
        if (util.existsFile(configFile)) {
            const {
                srcDir,
                ouputDir,
                baseUrl,
                cacheDeps,
                target,
                lang
            } = JSON.parse(await Deno.readTextFile(configFile))
            if (util.isNEString(srcDir)) {
                Object.assign(this.config, { srcDir: util.cleanPath(srcDir) })
            }
            if (util.isNEString(ouputDir)) {
                Object.assign(this.config, { ouputDir: util.cleanPath(ouputDir) })
            }
            if (util.isNEString(baseUrl)) {
                Object.assign(this.config, { baseUrl: util.cleanPath(encodeURI(baseUrl)) })
            }
            if (util.isNEString(lang)) {
                Object.assign(this.config, { defaultLocale: lang })
            }
            if (/^es(5|20\d{2}|next)$/i.test(target)) {
                Object.assign(this.config, { target })
            }
            if (typeof cacheDeps === 'boolean') {
                Object.assign(this.config, { cacheDeps })
            }
        }
    }

    private async _createMainModule(): Promise<Module> {
        const { rootDir, baseUrl, defaultLocale } = this.config
        const config: Record<string, any> = {
            baseUrl,
            defaultLocale,
            locales: {},
            dataModule: null,
            appModule: null,
            pageModules: {}
        }
        const deps: { url: string, hash: string }[] = []
        if (this.#modules.has('./data.js') || this.#modules.has('./data/index.js')) {
            const { url, hash } = this.#modules.get('./data.js') || this.#modules.get('./data/index.js')!
            config.dataModule = {
                moduleId: './data.js',
                hash
            }
            deps.push({ url, hash })
        }
        if (this.#modules.has('./app.js')) {
            const { url, hash } = this.#modules.get('./app.js')!
            config.appModule = {
                moduleId: './app.js',
                hash
            }
            deps.push({ url, hash })
        }
        this.#pageModules.forEach(({ moduleId }, pagePath) => {
            const { url, hash } = this.#modules.get(moduleId)!
            const mod = { moduleId, hash }
            config.pageModules[pagePath] = mod
            deps.push({ url, hash })
        })

        const jsContent = [
            `import './-/deno.land/x/aleph/vendor/tslib/tslib.js'`,
            this.isDev && `import './-/deno.land/x/aleph/hmr.js'`,
            `import { bootstrap } from './-/deno.land/x/aleph/app.js'`,
            `bootstrap(${JSON.stringify(config, undefined, this.isDev ? 4 : undefined)})`
        ].filter(Boolean).join('\n')
        const hash = (new Sha1()).update(jsContent).hex()
        const saveDir = path.join(rootDir, '.aleph', this.mode)
        const id = './main.js'
        const module: Module = {
            id,
            url: './main.js',
            isRemote: false,
            sourceFilePath: '/main.js',
            sourceType: 'js',
            sourceHash: hash,
            deps,
            jsFile: path.join(saveDir, `main.${hash.slice(0, hashShort)}.js`),
            jsContent,
            jsSourceMap: '',
            hash: hash,
        }
        await Promise.all([
            writeTextFile(module.jsFile, jsContent),
            writeTextFile(path.join(saveDir, 'main.meta.json'), JSON.stringify({
                url: './main.js',
                sourceHash: hash,
                hash,
                deps,
            }, undefined, 4))
        ])
        this.#modules.set(id, module)

        return module
    }

    private async _init() {
        const walkOptions = { includeDirs: false, exts: ['.js', '.jsx', '.mjs', '.ts', '.tsx'], skip: [/\.d\.ts$/i] }
        const dataDir = path.join(this.srcDir, 'data')
        const apiDir = path.join(this.srcDir, 'api')
        const pagesDir = path.join(this.srcDir, 'pages')

        if (!(util.existsDir(pagesDir))) {
            log.fatal('please create some pages.')
        }

        Object.assign(globalThis, {
            ALEPH_ENV: {
                appDir: this.config.rootDir,
            },
            $RefreshReg$: () => { },
            $RefreshSig$: () => (type: any) => type,
        })

        for await (const { path: p, isDirectory, isFile } of walk(this.srcDir, { maxDepth: 1 })) {
            const name = path.basename(p)
            if (isDirectory && p !== this.srcDir) {
                switch (name) {
                    case 'api':
                        for await (const { path: p } of walk(apiDir, walkOptions)) {
                            const rp = path.resolve(util.trimPrefix(p, apiDir))
                            await this._compile('./api/' + rp)
                        }
                        break
                    case 'data':
                        for await (const { path: p } of walk(dataDir, { ...walkOptions, maxDepth: 1 })) {
                            const name = path.basename(p)
                            if (name.replace(reModuleExt, '') === 'index') {
                                await this._compile('./data/' + name)
                            }
                        }
                        break
                }
            } else if (isFile && reModuleExt.test(name)) {
                switch (name.replace(reModuleExt, '')) {
                    case 'app':
                    case 'data':
                        await this._compile('./' + name)
                        break
                }
            }
        }

        for await (const { path: p } of walk(pagesDir, walkOptions)) {
            const rp = path.resolve(util.trimPrefix(p, pagesDir)) || '/'
            const pagePath = rp.replace(reModuleExt, '').replace(/\s+/g, '-').replace(/\/?index$/i, '/')
            this.#pageModules.set(pagePath, {
                moduleId: './pages' + rp.replace(reModuleExt, '') + '.js',
                rendered: new Map()
            })
            await this._compile('./pages' + rp)
        }

        const preCompileUrls = [
            'https://deno.land/x/aleph/vendor/tslib/tslib.js',
            this.isDev ? 'https://deno.land/x/aleph/hmr.ts' : '',
            'https://deno.land/x/aleph/app.ts',
            'https://deno.land/x/aleph/renderer.ts',
        ].filter(Boolean)
        for (const url of preCompileUrls) {
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
                const { rootDir, outputDir } = this.config
                const path = util.trimPrefix(util.trimPrefix(p, rootDir), '/')
                const validated = (() => {
                    if (!reModuleExt.test(path) && !reStyleModuleExt.test(path)) {
                        return false
                    }
                    // ignore '.aleph' and outputDir directories
                    if (path.startsWith('.aleph/') || path.startsWith(outputDir.slice(1))) {
                        return false
                    }
                    const moduleId = './' + path.replace(reModuleExt, '.js')
                    switch (moduleId) {
                        case './app.js':
                        case './data.js':
                        case './data/index.js': {
                            return true
                        }
                        default: {
                            if ((moduleId.startsWith('./pages/') || moduleId.startsWith('./api/')) && moduleId.endsWith('.js')) {
                                return true
                            }
                            let isDep = false
                            for (const { deps } of this.#modules.values()) {
                                if (deps.findIndex(dep => dep.url === '.' + path) > -1) {
                                    isDep = true
                                    break
                                }
                            }
                            return isDep
                        }
                    }
                })()
                if (validated) {
                    const moduleId = './' + path.replace(reModuleExt, '.js')
                    util.debounceX(moduleId, () => {
                        if (util.existsFile(p)) {
                            let type = 'modify'
                            if (!this.#modules.has(moduleId)) {
                                type = 'add'
                            }
                            log.info(type, './' + path)
                            this._compile('./' + path, { forceCompile: true }).then(({ hash }) => {
                                const hmrable = this.isHMRable(moduleId)
                                if (hmrable) {
                                    this.#fsWatchListeners.forEach(e => e.emit(moduleId, type, hash))
                                }
                                if (moduleId === './app.js' || moduleId === './data.js' || moduleId === './data/index.js') {
                                    this._clearPageRenderCache()
                                } else if (moduleId.startsWith('./pages/')) {
                                    this._clearPageRenderCache(moduleId)
                                }
                                this._updateDependency('./' + path, hash, mod => {
                                    if (!hmrable && this.isHMRable(mod.id)) {
                                        this.#fsWatchListeners.forEach(e => e.emit(mod.id, 'modify', mod.hash))
                                    }
                                    if (mod.id.startsWith('./pages/')) {
                                        this._clearPageRenderCache(mod.id)
                                    }
                                })
                            })
                        } else if (this.#modules.has(moduleId)) {
                            this.#modules.delete(moduleId)
                            if (moduleId === './app.js' || moduleId === './data.js' || moduleId === './data/index.js') {
                                this._clearPageRenderCache()
                                this._createMainModule()
                            } else if (moduleId.startsWith('./pages/')) {
                                this._removePageModule(moduleId)
                                this._createMainModule()
                            }
                            if (this.isHMRable(moduleId)) {
                                this.#fsWatchListeners.forEach(e => e.emit(moduleId, 'remove'))
                            }
                            log.info('remove', './' + path)
                        }
                    }, 150)
                }
            }
        }
    }

    private _removePageModule(moduleId: string) {
        let pagePath = ''
        for (const [p, pm] of this.#pageModules.entries()) {
            if (pm.moduleId === moduleId) {
                pagePath = p
                break
            }
        }
        if (pagePath !== '') {
            this.#pageModules.delete(pagePath)
        }
    }

    private _clearPageRenderCache(moduleId?: string) {
        for (const [_, p] of this.#pageModules.entries()) {
            if (moduleId === undefined || p.moduleId === moduleId) {
                p.rendered.clear()
                break
            }
        }
    }

    private async _compile(url: string, options?: { sourceCode?: string, implicitDeps?: { url: string, hash: string }[], forceCompile?: boolean }) {
        const { rootDir, importMap } = this.config
        const isRemote = reHttp.test(url) || (url in importMap.imports && reHttp.test(importMap.imports[url]))
        const sourceFilePath = renameImportUrl(url)
        const id = (isRemote ? '//' + util.trimPrefix(sourceFilePath, '/-/') : '.' + sourceFilePath).replace(reModuleExt, '.js')

        if (this.#modules.has(id) && !options?.forceCompile) {
            return this.#modules.get(id)!
        }

        const name = path.basename(sourceFilePath).replace(reModuleExt, '')
        const saveDir = path.join(rootDir, '.aleph', this.mode, path.dirname(sourceFilePath))
        const metaFile = path.join(saveDir, `${name}.meta.json`)
        const mod: Module = {
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
        }

        if (util.existsFile(metaFile)) {
            const { sourceHash, hash, deps } = JSON.parse(await Deno.readTextFile(metaFile))
            const jsFile = path.join(saveDir, name + (mod.isRemote ? '' : '.' + hash.slice(0, hashShort))) + '.js'
            if (util.isNEString(sourceHash) && util.isNEString(hash) && util.isArray(deps) && util.existsFile(jsFile)) {
                try {
                    mod.jsContent = await Deno.readTextFile(jsFile)
                    if (util.existsFile(jsFile + '.map')) {
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
        let emptyContent = false
        if (options?.sourceCode) {
            const sourceHash = (new Sha1()).update(options.sourceCode).hex()
            if (mod.sourceHash === '' || mod.sourceHash !== sourceHash) {
                sourceContent = options.sourceCode
                mod.sourceHash = sourceHash
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
            if (this.isDev && url.startsWith('https://esm.sh/')) {
                dlUrl += '?env=development'
            }
            if (mod.sourceHash === '') {
                log.info('Download', url, dlUrl != url ? colors.dim(`• ${dlUrl}`) : '')
                try {
                    const resp = await fetch(dlUrl)
                    if (resp.status != 200) {
                        throw new Error(`${resp.status} - ${resp.statusText}`)
                    }
                    sourceContent = await resp.text()
                    mod.sourceHash = (new Sha1()).update(sourceContent).hex()
                    if (mod.sourceType === 'js') {
                        const t = resp.headers.get('Content-Type')
                        if (t?.startsWith('text/typescript')) {
                            mod.sourceType = 'ts'
                        } else if (t?.startsWith('text/jsx')) {
                            mod.sourceType = 'jsx'
                        }
                    }
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
                        sourceContent = text
                        mod.sourceHash = sourceHash
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
                sourceContent = text
                emptyContent = text === ''
                mod.sourceHash = sourceHash
            }
        }

        let fsync = false

        // compile source
        if (sourceContent != '' || emptyContent) {
            const t = performance.now()
            mod.deps = options?.implicitDeps || []
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
                const savePath = path.join(path.dirname(sourceFilePath), util.trimSuffix(path.basename(sourceFilePath), '.css') + '.' + hash.slice(0, hashShort) + '.css')
                if (css.length > 1024) {
                    await writeTextFile(path.join(rootDir, '.aleph', this.mode, savePath), css)
                }
                mod.jsContent = [
                    `import { applyCSS } from ${JSON.stringify(relativePath(
                        path.dirname(path.resolve('/', mod.url)),
                        '/-/deno.land/x/aleph/head.js'
                    ))};`,
                    `applyCSS(${JSON.stringify(url)}, ${css.length > 1024 ? JSON.stringify(path.join(this.config.baseUrl, '_dist', savePath)) + ', true' : JSON.stringify(css)});`,
                ].join(this.isDev ? '\n' : '')
                mod.hash = hash
                mod.jsSourceMap = ''
            } else {
                const compileOptions = {
                    target: this.config.target,
                    mode: this.mode,
                    reactRefresh: this.isDev && !mod.isRemote && (mod.id === './app.js' || mod.id.startsWith('./pages/') || mod.id.startsWith('./components/')),
                    rewriteImportPath: (path: string) => this._rewriteImportPath(mod, path),
                }
                const { diagnostics, outputText, sourceMapText } = compile(mod.url, sourceContent, compileOptions)
                if (diagnostics && diagnostics.length > 0) {
                    throw new Error(`compile ${url}: ${diagnostics.map(d => d.messageText).join(' ')}`)
                }
                const jsContent = outputText.replace(/import([^'"]*)("|')tslib("|')(\)|;)?/g, 'import$1' + JSON.stringify(relativePath(
                    path.dirname(mod.sourceFilePath),
                    '/-/deno.land/x/aleph/vendor/tslib/tslib.js'
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
                    mod.jsContent = code
                    mod.jsSourceMap = map
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
                        path.dirname(path.resolve('/', url)),
                        path.resolve('/', dep.url.replace(reModuleExt, ''))
                    )
                    mod.jsContent = mod.jsContent.replace(/(import|export)([^'"]*)("|')([^'"]+)("|')(\)|;)?/g, (s, key, from, ql, importPath, qr, end) => {
                        if (
                            reHashJs.test(importPath) &&
                            importPath.slice(0, importPath.length - (hashShort + 4)) === depImportPath
                        ) {
                            return `${key}${from}${ql}${depImportPath}.${dep.hash.slice(0, hashShort)}.js${qr}${end}`
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
                        path.dirname(path.resolve('/', mod.url)),
                        path.resolve('/', dep.url.replace(reModuleExt, ''))
                    )
                    dep.hash = depHash
                    if (mod.id === './main.js') {
                        this._createMainModule()
                    } else {
                        mod.jsContent = mod.jsContent.replace(/(import|export)([^'"]*)("|')([^'"]+)("|')(\)|;)?/g, (s, key, from, ql, importPath, qr, end) => {
                            if (
                                reHashJs.test(importPath) &&
                                importPath.slice(0, importPath.length - (hashShort + 4)) === depImportPath
                            ) {
                                return `${key}${from}${ql}${depImportPath}.${dep.hash.slice(0, hashShort)}.js${qr}${end}`
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

    private _rewriteImportPath(mod: Module, importPath: string): string {
        const { cacheDeps, importMap } = this.config
        let rewrittenPath: string
        if (importPath in importMap.imports) {
            importPath = importMap.imports[importPath]
        }
        if (reHttp.test(importPath)) {
            if (cacheDeps || /\.(jsx|tsx?)$/i.test(importPath)) {
                if (mod.isRemote) {
                    rewrittenPath = relativePath(
                        path.dirname(path.resolve('/', mod.url.replace(reHttp, '-/').replace(/:(\d+)/, `/$1`))),
                        renameImportUrl(importPath)
                    )
                } else {
                    rewrittenPath = relativePath(
                        path.dirname(path.resolve('/', mod.url)),
                        renameImportUrl(importPath)
                    )
                }
            } else {
                rewrittenPath = importPath
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
            mod.deps.push({ url: importPath, hash: '' })
        } else {
            if (mod.isRemote) {
                const sourceUrl = new URL(mod.url)
                let pathname = importPath
                if (!pathname.startsWith('/')) {
                    pathname = path.join(path.dirname(sourceUrl.pathname), importPath)
                }
                mod.deps.push({ url: sourceUrl.protocol + '//' + sourceUrl.host + pathname, hash: '' })
            } else {
                mod.deps.push({ url: '.' + path.resolve('/', path.dirname(mod.url), importPath), hash: '' })
            }
        }

        if (reHttp.test(rewrittenPath)) {
            return rewrittenPath
        }

        if (!rewrittenPath.startsWith('.') && !rewrittenPath.startsWith('/')) {
            rewrittenPath = './' + rewrittenPath
        }
        return rewrittenPath.replace(reModuleExt, '') + '.js'
    }

    private async _renderPage(url: RouterURL) {
        const start = performance.now()
        const ret: RenderResult = {
            code: 404,
            head: ['<title>404 - page not found</title>'],
            body: '<p><strong><code>404</code></strong><small> - </small><span>page not found</span></p>',
        }
        if (this.#pageModules.has(url.pagePath)) {
            const pm = this.#pageModules.get(url.pagePath)!
            const mod = this.#modules.get(pm.moduleId)!
            const appMod = this.#modules.get('./app.js')
            if (pm.rendered.has(url.pathname)) {
                const cache = pm.rendered.get(url.pathname)!
                return { ...cache }
            }
            try {
                const [
                    { renderPage, renderHead },
                    App,
                    Page
                ] = await Promise.all([
                    import(this.#modules.get('//deno.land/x/aleph/renderer.js')!.jsFile),
                    this.importModuleAsComponent('./app.js'),
                    this.importModuleAsComponent(pm.moduleId)
                ])
                if (Page.Component) {
                    const data = await this.getData()
                    const html = renderPage(data, url, App.Component ? App : undefined, Page)
                    const head = renderHead([
                        mod.deps.map(({ url }) => url).filter(url => reStyleModuleExt.test(url)),
                        appMod?.deps.map(({ url }) => url).filter(url => reStyleModuleExt.test(url))
                    ].filter(Boolean).flat())
                    ret.code = 200
                    ret.head = head
                    ret.body = `<main>${html}</main>`
                    pm.rendered.set(url.pathname, { ...ret })
                    log.debug(`render page '${url.pagePath}' in ${Math.round(performance.now() - start)}ms`)
                } else {
                    ret.code = 500
                    ret.head = ['<title>500 - render error</title>']
                    ret.body = `<p><strong><code>500</code></strong><small> - </small><span>render error: bad page component</span></p>`
                }
            } catch (err) {
                ret.code = 500
                ret.head = ['<title>500 - render error</title>']
                ret.body = `<pre>${AnsiUp.ansi_to_html(err.stack)}</pre>`
                log.error(err.stack)
            }
        }
        return ret
    }
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
    const url = new URL(isRemote ? importUrl : 'file://' + path.resolve('/', importUrl))
    const ext = path.extname(path.basename(url.pathname)) || '.js'
    let pathname = util.trimSuffix(url.pathname, ext)
    if (url.search) {
        pathname += '/' + btoa(url.search).replace(/[\.\/=]/g, '')
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
