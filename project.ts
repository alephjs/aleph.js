import type { APIHandle, Location, RouterURL } from './api.ts'
import { AnsiUp, colors, ensureDir, exists, existsSync, less, minify, path, Sha1, walk } from './deps.ts'
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
const cleanCSS = new CleanCSS({ compatibility: '*' }) // Internet Explorer 10+

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
    deps: { path: string, hash: string }[]
    sourceFilePath: string
    sourceType: string
    sourceHash: string
    jsFile: string
    jsContent: string
    jsSourceMap: string
    hash: string
}

interface BuildManifest {
    baseUrl: string
    defaultLocale: string
    locales: Record<string, Record<string, string>>
    appModule: { hash: string } | null
    pageModules: Record<string, { moduleId: string, hash: string }>
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
    #fsWatchQueue: Map<string, number> = new Map()
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

    get manifest() {
        const { baseUrl, defaultLocale } = this.config
        const manifest: BuildManifest = {
            baseUrl,
            defaultLocale,
            locales: {},
            appModule: null,
            pageModules: {}
        }
        if (this.#modules.has('./app.js')) {
            manifest.appModule = {
                hash: this.#modules.get('./app.js')!.hash
            }
        }
        this.#pageModules.forEach(({ moduleId }, pagePath) => {
            const { hash } = this.#modules.get(moduleId)!
            manifest.pageModules[pagePath] = { moduleId, hash }
        })
        return manifest
    }

    get isDev() {
        return this.mode === 'development'
    }

    isHMRable(moduleId: string) {
        if (reHttp.test(moduleId)) {
            return false
        }
        return moduleId === './app.js' || moduleId.startsWith('./pages/') || moduleId.startsWith('./components/') || reStyleModuleExt.test(moduleId)
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
            modId = util.trimSuffix(util.trimPrefix(modId, '/-/'), '.js')
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

    async build() {
        const start = performance.now()
        const outputDir = path.join(this.srcDir, this.config.outputDir)
        const publicDir = path.join(this.srcDir, 'public')
        const distDir = path.join(outputDir, '_dist')
        await this.ready
        if (await this._existsDir(outputDir)) {
            await Deno.remove(outputDir, { recursive: true })
        }
        await Promise.all([outputDir, distDir].map(dir => ensureDir(dir)))
        await Promise.all(Array.from(this.#modules.values())
            .filter(({ id }) => {
                switch (id) {
                    case './renderer.js':
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
                return this._writeTextFile(jsFile, jsContent)
            }))
        for (const pathname of this.#pageModules.keys()) {
            const [_, html] = await this.getPageHtml({ pathname })
            const htmlFile = path.join(outputDir, pathname, 'index.html')
            await this._writeTextFile(htmlFile, html)
        }
        if (this._existsDir(publicDir)) {
            for await (const { path: p } of walk(publicDir, { includeDirs: false })) {
                const rp = path.resolve(util.trimPrefix(p, publicDir))
                await Deno.copyFile(p, path.join(outputDir, rp))
            }
        }
        log.info(`Done in ${Math.round(performance.now() - start)}ms`)
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

    private async _loadConfig() {
        const { ALEPH_IMPORT_MAP } = globalThis as any
        if (ALEPH_IMPORT_MAP) {
            const { imports } = ALEPH_IMPORT_MAP
            Object.assign(this.config.importMap, { imports: Object.assign({}, this.config.importMap.imports, imports) })
        }

        const importMapFile = path.join(this.config.rootDir, 'import_map.json')
        if (await exists(importMapFile)) {
            const { imports } = JSON.parse(await Deno.readTextFile(importMapFile))
            Object.assign(this.config.importMap, { imports: Object.assign({}, this.config.importMap.imports, imports) })
        }

        const configFile = path.join(this.config.rootDir, 'post.config.json')
        if (await exists(configFile)) {
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
            if (/^es(20\d{2}|next)$/i.test(target)) {
                Object.assign(this.config, { target })
            }
            if (typeof cacheDeps === 'boolean') {
                Object.assign(this.config, { cacheDeps })
            }
        }

        Object.assign(globalThis, {
            ALEPH_ENV: {
                appDir: this.config.rootDir
            },
            $RefreshReg$: () => { },
            $RefreshSig$: () => (type: any) => type,
        })
    }

    private async _init() {
        const walkOptions = { includeDirs: false, exts: ['.js', '.jsx', '.mjs', '.ts', '.tsx'], skip: [/\.d\.ts$/i] }
        const apiDir = path.join(this.srcDir, 'api')
        const pagesDir = path.join(this.srcDir, 'pages')

        if (!(await this._existsDir(pagesDir))) {
            log.error('please create some pages.')
            Deno.exit(0)
        }

        for await (const { path: p } of walk(this.srcDir, { ...walkOptions, maxDepth: 1 })) {
            const name = path.basename(p)
            if (name.replace(reModuleExt, '') === 'app') {
                await this._compile('./' + name)
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

        if (await this._existsDir(apiDir)) {
            for await (const { path: p } of walk(apiDir, walkOptions)) {
                const rp = path.resolve(util.trimPrefix(p, apiDir))
                await this._compile('./api/' + rp)
            }
        }

        const innerModules: Record<string, string> = {
            './main.js': [
                `import 'https://deno.land/x/aleph/vendor/tslib/tslib.js'`,
                this.isDev && `import 'https://deno.land/x/aleph/hmr.ts'`,
                `import { bootstrap } from 'https://deno.land/x/aleph/app.ts'`,
                `bootstrap(${JSON.stringify(this.manifest)})`
            ].filter(Boolean).join('\n'),
            './renderer.js': `export * from 'https://deno.land/x/aleph/renderer.ts'`
        }
        for (const path in innerModules) {
            await this._compile(path, { sourceCode: innerModules[path] })
        }

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
                const rp = util.trimPrefix(util.trimPrefix(p, rootDir), '/')
                if ((reModuleExt.test(rp) || reStyleModuleExt.test(rp)) && !rp.startsWith('.aleph/') && !rp.startsWith(outputDir.slice(1))) {
                    const moduleId = './' + rp.replace(reModuleExt, '.js')
                    if (this.#fsWatchQueue.has(moduleId)) {
                        clearTimeout(this.#fsWatchQueue.get(moduleId)!)
                    }
                    this.#fsWatchQueue.set(moduleId, setTimeout(() => {
                        this.#fsWatchQueue.delete(moduleId)
                        if (existsSync(p)) {
                            let type = 'modify'
                            if (!this.#modules.has(moduleId)) {
                                type = 'add'
                            }
                            log.info(type, './' + rp)
                            this._compile('./' + rp, { forceCompile: true }).then(({ hash }) => {
                                const hmrable = this.isHMRable(moduleId)
                                if (hmrable) {
                                    this.#fsWatchListeners.forEach(e => e.emit(moduleId, type, hash))
                                }
                                if (moduleId.startsWith('./pages/')) {
                                    this._resetPageModule(moduleId)
                                }
                                this._updateDependency('./' + rp, hash, mod => {
                                    if (!hmrable && this.isHMRable(mod.id)) {
                                        this.#fsWatchListeners.forEach(e => e.emit(mod.id, 'modify', mod.hash))
                                    }
                                    if (mod.id.startsWith('./pages/')) {
                                        this._resetPageModule(mod.id)
                                    }
                                })
                            })
                        } else if (this.#modules.has(moduleId)) {
                            if (moduleId.startsWith('./pages/')) {
                                this._removePageModule(moduleId)
                            }
                            this.#modules.delete(moduleId)
                            if (this.isHMRable(moduleId)) {
                                this.#fsWatchListeners.forEach(e => e.emit(moduleId, 'remove'))
                            }
                            log.info('remove', './' + rp)
                        }
                    }, 150))
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

    private _resetPageModule(moduleId: string) {
        for (const [p, pm] of this.#pageModules.entries()) {
            if (pm.moduleId === moduleId) {
                pm.rendered.clear()
                break
            }
        }
    }

    private async _compile(url: string, options?: { sourceCode?: string, forceCompile?: boolean }) {
        const { rootDir, importMap } = this.config
        const isRemote = reHttp.test(url) || (url in importMap.imports && reHttp.test(importMap.imports[url]))
        const sourceFilePath = this._renameImportUrl(url)
        const id = (isRemote ? util.trimPrefix(sourceFilePath, '/-/') : '.' + sourceFilePath).replace(reModuleExt, '.js')

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

        if (existsSync(metaFile)) {
            const { sourceHash, hash, deps } = JSON.parse(await Deno.readTextFile(metaFile))
            const jsFile = path.join(saveDir, name + (mod.isRemote ? '' : '.' + hash.slice(0, hashShort))) + '.js'
            if (util.isNEString(sourceHash) && util.isNEString(hash) && util.isArray(deps) && existsSync(jsFile)) {
                try {
                    mod.jsContent = await Deno.readTextFile(jsFile)
                    if (existsSync(jsFile + '.map')) {
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
                const savePath = path.join(path.dirname(sourceFilePath), util.trimSuffix(path.basename(sourceFilePath), '.css') + '.' + hash.slice(0, hashShort) + '.css')
                if (css.length > 1024) {
                    await this._writeTextFile(path.join(rootDir, '.aleph', this.mode, savePath), css)
                }
                mod.jsContent = [
                    `import { applyCSS } from ${JSON.stringify(this._relativePath(
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
                    rewriteImportPath: (path: string) => this._rewriteImportPath(mod, path),
                    reactRefresh: this.isDev && !mod.isRemote,
                }
                const { diagnostics, outputText, sourceMapText } = compile(mod.url, sourceContent, compileOptions)
                if (diagnostics && diagnostics.length > 0) {
                    throw new Error(`compile ${url}: ${diagnostics.map(d => d.messageText).join(' ')}`)
                }
                const jsContent = outputText.replace(/import([^'"]*)("|')tslib("|')(\)|;)?/g, 'import$1' + JSON.stringify(this._relativePath(
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
            const depMod = await this._compile(dep.path)
            if (dep.hash !== depMod.hash) {
                dep.hash = depMod.hash
                if (!reHttp.test(dep.path)) {
                    const depImportPath = this._relativePath(
                        path.dirname(path.resolve('/', url)),
                        path.resolve('/', dep.path.replace(reModuleExt, ''))
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
                this._writeTextFile(metaFile, JSON.stringify({
                    url,
                    sourceHash: mod.sourceHash,
                    hash: mod.hash,
                    deps: mod.deps,
                }, undefined, 4)),
                this._writeTextFile(mod.jsFile, mod.jsContent),
                mod.jsSourceMap !== '' ? this._writeTextFile(mod.jsFile + '.map', mod.jsSourceMap) : Promise.resolve()
            ])
        }

        return mod
    }

    private _updateDependency(depPath: string, depHash: string, callback: (mod: Module) => void) {
        this.#modules.forEach(mod => {
            mod.deps.forEach(dep => {
                if (dep.path === depPath && dep.hash !== depHash) {
                    const depImportPath = this._relativePath(
                        path.dirname(path.resolve('/', mod.url)),
                        path.resolve('/', dep.path.replace(reModuleExt, ''))
                    )
                    dep.hash = depHash
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
                    this._writeTextFile(mod.jsFile.replace(reHashJs, '') + '.meta.json', JSON.stringify({
                        sourceFile: mod.url,
                        sourceHash: mod.sourceHash,
                        hash: mod.hash,
                        deps: mod.deps,
                    }, undefined, 4))
                    this._writeTextFile(mod.jsFile, mod.jsContent)
                    if (mod.jsSourceMap) {
                        this._writeTextFile(mod.jsFile + '.map', mod.jsSourceMap)
                    }
                    callback(mod)
                    this._updateDependency(mod.url, mod.hash, callback)
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
                    rewrittenPath = this._relativePath(
                        path.dirname(path.resolve('/', mod.url.replace(reHttp, '-/').replace(/:(\d+)/, `/$1`))),
                        this._renameImportUrl(importPath)
                    )
                } else {
                    rewrittenPath = this._relativePath(
                        path.dirname(path.resolve('/', mod.url)),
                        this._renameImportUrl(importPath)
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
                rewrittenPath = this._relativePath(
                    path.dirname(mod.sourceFilePath),
                    this._renameImportUrl(importUrl.toString())
                )
            } else {
                rewrittenPath = importPath.replace(reModuleExt, '') + '.' + 'x'.repeat(hashShort)
            }
        }
        if (reHttp.test(importPath)) {
            mod.deps.push({ path: importPath, hash: '' })
        } else {
            if (mod.isRemote) {
                const sourceUrl = new URL(mod.url)
                let pathname = importPath
                if (!pathname.startsWith('/')) {
                    pathname = path.join(path.dirname(sourceUrl.pathname), importPath)
                }
                mod.deps.push({ path: sourceUrl.protocol + '//' + sourceUrl.host + pathname, hash: '' })
            } else {
                mod.deps.push({ path: '.' + path.resolve('/', path.dirname(mod.url), importPath), hash: '' })
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

    private _renameImportUrl(importUrl: string): string {
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

    private async _renderPage(url: RouterURL) {
        const ret: RenderResult = {
            code: 404,
            head: ['<title>404 - page not found</title>'],
            body: '<p><strong><code>404</code></strong><small> - </small><span>page not found</span></p>',
        }
        if (this.#pageModules.has(url.pagePath)) {
            const pm = this.#pageModules.get(url.pagePath)!
            const mod = this.#modules.get(pm.moduleId)!
            const appMod = this.#modules.get('./app.js')
            if (pm.rendered.has(url.asPath)) {
                const cache = pm.rendered.get(url.asPath)!
                return { ...cache }
            }
            try {
                const [
                    { renderPage, renderHead },
                    App,
                    Page
                ] = await Promise.all([
                    import(this.#modules.get('./renderer.js')!.jsFile),
                    this.importModuleAsComponent('./app.js'),
                    this.importModuleAsComponent(pm.moduleId)
                ])
                if (Page.Component) {
                    const html = renderPage(url, App.Component ? App : undefined, Page)
                    const head = renderHead([
                        mod.deps.filter(({ path }) => reStyleModuleExt.test(path)).map(({ path }) => path),
                        appMod?.deps.filter(({ path }) => reStyleModuleExt.test(path)).map(({ path }) => path)
                    ].filter(Boolean).flat())
                    ret.code = 200
                    ret.head = head
                    ret.body = `<main>${html}</main>`
                    pm.rendered.set(url.asPath, { ...ret })
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

    private _relativePath(from: string, to: string): string {
        let r = path.relative(from, to)
        if (!r.startsWith('.') && !r.startsWith('/')) {
            r = './' + r
        }
        return r
    }

    private async _existsDir(path: string) {
        try {
            const fi = await Deno.lstat(path)
            if (fi.isDirectory) {
                return true
            }
            return false
        } catch (err) {
            if (err instanceof Deno.errors.NotFound) {
                return false
            }
            throw err
        }
    }

    private async _writeTextFile(filepath: string, content: string) {
        const dir = path.dirname(filepath)
        await ensureDir(dir)
        await Deno.writeTextFile(filepath, content)
    }
}
