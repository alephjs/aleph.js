import type { ImportMap, TransformOptions } from '../compiler/mod.ts'
import { buildChecksum, initWasm, transformSync } from '../compiler/mod.ts'
import { colors, createHash, ensureDir, minify, path, walk } from '../deps.ts'
import { EventEmitter } from '../framework/core/events.ts'
import type { RouteModule } from '../framework/core/routing.ts'
import { createBlankRouterURL, isModuleURL, Routing, toPagePath } from '../framework/core/routing.ts'
import { minDenoVersion, moduleExts } from '../shared/constants.ts'
import { ensureTextFile, existsDirSync, existsFileSync } from '../shared/fs.ts'
import log from '../shared/log.ts'
import util from '../shared/util.ts'
import type { Config, LoaderPlugin, LoaderTransformResult, RouterURL, ServerRequest } from '../types.ts'
import { VERSION } from '../version.ts'
import { Request } from './api.ts'
import { Bundler } from './bundler.ts'
import { defaultConfig, loadConfig } from './config.ts'
import { clearCompilation, computeHash, createHtml, formatBytesWithColor, getAlephPkgUri, getRelativePath, reFullVersion, reHashJs, reHashResolve, respondErrorJSON } from './helper.ts'

/** A module includes the compilation details. */
export type Module = {
  url: string
  hash: string
  sourceHash: string
  deps: DependencyDescriptor[]
  jsFile: string
}

/** The dependency descriptor. */
export type DependencyDescriptor = {
  url: string
  hash: string
  isDynamic?: boolean
}

/** The render result of SSR. */
export type RenderResult = {
  url: RouterURL
  status: number
  head: string[]
  body: string
  scripts: Record<string, any>[]
  data: Record<string, string> | null
}

/** The Aleph Server Application class. */
export class Application {
  readonly workingDir: string
  readonly mode: 'development' | 'production'
  readonly config: Required<Config>
  readonly importMap: ImportMap
  readonly ready: Promise<void>

  #dirs: Map<string, string> = new Map()
  #modules: Map<string, Module> = new Map()
  #pageRouting: Routing = new Routing({})
  #apiRouting: Routing = new Routing({})
  #fsWatchListeners: Array<EventEmitter> = []
  #bundler: Bundler = new Bundler(this)
  #renderer: { render: CallableFunction } = { render: () => { } }
  #renderCache: Map<string, Map<string, RenderResult>> = new Map()
  #compilerReady: Promise<void> | boolean = false
  #reloading = false

  constructor(workingDir = '.', mode: 'development' | 'production' = 'production', reload = false) {
    this.workingDir = path.resolve(workingDir)
    this.mode = mode
    this.config = { ...defaultConfig }
    this.importMap = { imports: {}, scopes: {} }
    this.ready = this.init(reload)
  }

  /** initiate application */
  private async init(reload: boolean) {
    const t = performance.now()
    const alephPkgUri = getAlephPkgUri()
    const { env, framework, plugins, ssr } = this.config
    const walkOptions = { includeDirs: false, exts: moduleExts, skip: [/^\./, /\.d\.ts$/i, /\.(test|spec|e2e)\.m?(j|t)sx?$/i] }
    const apiDir = path.join(this.srcDir, 'api')
    const pagesDir = path.join(this.srcDir, 'pages')

    if (!(existsDirSync(pagesDir))) {
      log.fatal(`'pages' directory not found.`)
    }

    if (Deno.version.deno < minDenoVersion) {
      log.fatal(`need Deno ${minDenoVersion}+, but got ${Deno.version.deno}`)
    }

    const p = Deno.run({
      cmd: [Deno.execPath(), 'info', '--unstable', '--json'],
      stdout: 'piped',
      stderr: 'null'
    })
    const output = (new TextDecoder).decode(await p.output())
    const { denoDir } = JSON.parse(output)
    p.close()
    if (!existsDirSync(denoDir)) {
      log.fatal(`can't find the deno dir`)
    }
    this.#dirs.set('denoDir', denoDir)

    if (reload) {
      this.#reloading = true
      if (existsDirSync(this.buildDir)) {
        await Deno.remove(this.buildDir, { recursive: true })
      }
      await ensureDir(this.buildDir)
    }

    // change current working directory to appDoot
    Deno.chdir(this.workingDir)

    // inject env variables
    Object.entries(env).forEach(([key, value]) => Deno.env.set(key, value))
    Deno.env.set('ALEPH_VERSION', VERSION)
    Deno.env.set('BUILD_MODE', this.mode)

    const [config, importMap] = await loadConfig(this.workingDir)
    Object.assign(this.config, config)
    Object.assign(this.importMap, importMap)

    // create page routing
    this.#pageRouting = new Routing(this.config)

    if (!this.isDev) {
      log.info('Building...')
    }

    // check custom components
    for await (const { path: p, } of walk(this.srcDir, { ...walkOptions, maxDepth: 1 })) {
      const name = path.basename(p)
      switch (util.trimModuleExt(name)) {
        case 'app':
        case '404':
        case 'loading':
          await this.compile('/' + name)
          break
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
    for await (const { path: p } of walk(pagesDir, { ...walkOptions })) {
      const mod = await this.compile(util.cleanPath('/pages/' + util.trimPrefix(p, pagesDir)))
      this.#pageRouting.update(this.getRouteModule(mod))
    }

    // pre-compile framework modules
    await this.compile(`${alephPkgUri}/framework/${framework}/bootstrap.ts`)
    if (this.isDev) {
      const mods = ['hmr.ts', 'nomodule.ts']
      for (const mod of mods) {
        await this.compile(`${alephPkgUri}/framework/core/${mod}`)
      }
      // add fast-refresh support
      if (framework === 'react') {
        Object.assign(globalThis, {
          $RefreshReg$: () => { },
          $RefreshSig$: () => (type: any) => type,
        })
        await this.compile(`${alephPkgUri}/framework/react/refresh.ts`)
      }
    }

    // pre-bundle
    if (!this.isDev) {
      await this.bundle()
    }

    // compile and import framework renderer when ssr is enable
    if (ssr) {
      const rendererModuleUrl = `${alephPkgUri}/framework/${framework}/renderer.ts`
      const { jsFile } = await this.compile(rendererModuleUrl, { once: true })
      const { render } = await import('file://' + jsFile)
      this.#renderer = { render }
    }

    // apply server plugins
    for (const plugin of plugins) {
      if (plugin.type === 'server') {
        await plugin.onInit(this)
      }
    }

    // reload end
    if (reload) {
      this.#reloading = false
    }

    log.debug(`init project in ${Math.round(performance.now() - t)}ms`)

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
        const url = util.cleanPath(util.trimPrefix(p, this.srcDir))
        const validated = () => {
          // ignore `.aleph` and output directories
          if (url.startsWith('/.aleph/') || url.startsWith(this.config.outputDir)) {
            return false
          }

          // is module
          if (isModuleURL(url)) {
            if (url.startsWith('/pages/') || url.startsWith('/api/')) {
              return true
            }
            switch (util.trimModuleExt(url)) {
              case '/404':
              case '/app':
                return true
            }
          }

          // is dep
          for (const { deps } of this.#modules.values()) {
            if (deps.findIndex(dep => dep.url === url) > -1) {
              return true
            }
          }

          // is loaded by plugin
          return this.config.plugins.findIndex(p => p.type === 'loader' && p.test.test(url)) > -1
        }

        if (validated()) {
          util.debounceX(url, () => {
            if (existsFileSync(p)) {
              let type = 'modify'
              if (!this.#modules.has(url)) {
                type = 'add'
              }
              log.info(type, url)
              this.compile(url, { forceCompile: true }).then(mod => {
                const hmrable = this.isHMRable(mod.url)
                const update = ({ url, hash }: Module) => {
                  if (util.trimModuleExt(url) === '/app') {
                    this.#renderCache.clear()
                  } else if (url.startsWith('/pages/')) {
                    this.#renderCache.delete(toPagePath(url))
                    this.#pageRouting.update(this.getRouteModule({ url, hash }))
                  } else if (url.startsWith('/api/')) {
                    this.#apiRouting.update(this.getRouteModule({ url, hash }))
                  }
                }
                if (hmrable) {
                  if (type === 'add') {
                    this.#fsWatchListeners.forEach(e => e.emit('add', { url: mod.url, hash: mod.hash }))
                  } else {
                    this.#fsWatchListeners.forEach(e => e.emit('modify-' + mod.url, mod.hash))
                  }
                }
                update(mod)
                this.checkCompilationSideEffect(url, (mod) => {
                  update(mod)
                  if (!hmrable && this.isHMRable(mod.url)) {
                    this.#fsWatchListeners.forEach(w => w.emit('modify-' + mod.url, mod.hash))
                  }
                })
              }).catch(err => {
                log.error(`compile(${url}):`, err.message)
              })
            } else if (this.#modules.has(url)) {
              if (util.trimModuleExt(url) === '/app') {
                this.#renderCache.clear()
              } else if (url.startsWith('/pages/')) {
                this.#renderCache.delete(toPagePath(url))
                this.#pageRouting.removeRoute(toPagePath(url))
              } else if (url.startsWith('/api/')) {
                this.#apiRouting.removeRoute(toPagePath(url))
              }
              this.#modules.delete(url)
              if (this.isHMRable(url)) {
                this.#fsWatchListeners.forEach(e => e.emit('remove', url))
              }
              log.info('remove', url)
            }
          }, 150)
        }
      }
    }
  }

  get isDev() {
    return this.mode === 'development'
  }

  get srcDir() {
    return this.getDir('src', () => path.join(this.workingDir, this.config.srcDir))
  }

  get outputDir() {
    return this.getDir('output', () => path.join(this.workingDir, this.config.outputDir))
  }

  get buildDir() {
    return this.getDir('build', () => path.join(this.workingDir, '.aleph', this.mode))
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
    const url = util.cleanPath('/pages/' + pathname) + '.tsx'
    const mod = await this.compile(url, { sourceCode: code })
    this.#pageRouting.update(this.getRouteModule(mod))
  }

  /** remove the page module by given path. */
  async removePageModule(pathname: string): Promise<void> {
    const url = util.cleanPath('/pages/' + pathname) + '.tsx'
    if (this.#modules.has(url)) {
      await clearCompilation(this.#modules.get(url)!.jsFile)
      this.#modules.delete(url)
      this.#pageRouting.removeRoute(url)
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
        ...this.getHTMLScripts(),
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
        ...this.getHTMLScripts()
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

    // wait for app ready
    await this.ready

    // clear previous build
    if (existsDirSync(outputDir)) {
      for await (const entry of Deno.readDir(outputDir)) {
        await Deno.remove(path.join(outputDir, entry.name), { recursive: entry.isDirectory })
      }
    }
    await ensureDir(distDir)

    //  optimizing
    await this.optimize()
    // ssg
    await this.ssg()
    // copy bundle dist
    await this.#bundler.copyDist()

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

  async handleAPIRequest(req: ServerRequest, loc: { pathname: string, search?: string }) {
    const [url, nestedModules] = this.#apiRouting.createRouter({
      ...loc,
      pathname: decodeURI(loc.pathname)
    })
    if (url.pagePath !== '') {
      const { url: moduleUrl } = nestedModules.pop()!
      try {
        const { default: handle } = await import('file://' + this.#modules.get(moduleUrl)!.jsFile)
        if (util.isFunction(handle)) {
          await handle(new Request(req, url.params, url.query))
        } else {
          respondErrorJSON(req, 500, 'bad api handler')
        }
      } catch (err) {
        respondErrorJSON(req, 500, err.message)
        log.error('invoke API:', err)
      }
    } else {
      respondErrorJSON(req, 404, 'not found')
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

  isHMRable(url: string) {
    if (!this.isDev) {
      return false
    }
    for (const ext of moduleExts) {
      if (url.endsWith('.' + ext)) {
        return url.startsWith('/pages/') ||
          url.startsWith('/components/') ||
          ['/app', '/404'].includes(util.trimModuleExt(url))
      }
    }
    for (const plugin of this.config.plugins) {
      if (plugin.type === 'loader' && plugin.test.test(url)) {
        return plugin.acceptHMR
      }
    }
    return false
  }

  /** inject HMR code  */
  injectHMRCode({ url }: Module, content: string): string {
    const DEV_PORT = Deno.env.get('ALEPH_DEV_PORT')
    const alephModuleLocalUrlPrefix = DEV_PORT ? `http_localhost_${DEV_PORT}` : `deno.land/x/aleph@v${VERSION}`
    const baseUrl = path.dirname(this.toLocalUrl(url))
    const hmrImportPath = getRelativePath(
      baseUrl,
      `/-/${alephModuleLocalUrlPrefix}/framework/core/hmr.js`
    )
    const lines = [
      `import { createHotContext } from ${JSON.stringify(hmrImportPath)};`,
      `import.meta.hot = createHotContext(${JSON.stringify(url)});`
    ]
    const reactRefresh = this.config.framework === 'react' && (content.includes('$RefreshReg$') || content.includes('$RefreshSig$'))
    if (reactRefresh) {
      const refreshImportPath = getRelativePath(
        baseUrl,
        `/-/${alephModuleLocalUrlPrefix}/framework/react/refresh.js`
      )
      lines.push(
        `import { RefreshRuntime, performReactRefresh } from ${JSON.stringify(refreshImportPath)};`,
        '',
        'const prevRefreshReg = window.$RefreshReg$;',
        'const prevRefreshSig = window.$RefreshSig$;',
        `window.$RefreshReg$ = (type, id) => RefreshRuntime.register(type, ${JSON.stringify(url)} + "#" + id);`,
        'window.$RefreshSig$ = RefreshRuntime.createSignatureFunctionForTransform;',
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

  /** get main code in javascript. */
  getMainJS(bundleMode = false): string {
    const alephPkgUri = getAlephPkgUri()
    const { baseUrl: baseURL, defaultLocale, framework } = this.config
    const config: Record<string, any> = {
      baseURL,
      defaultLocale,
      locales: [],
      routes: this.#pageRouting.routes,
      rewrites: this.config.rewrites,
      sharedModules: Array.from(this.#modules.values()).filter(({ url }) => {
        switch (util.trimModuleExt(url)) {
          case '/404':
          case '/app':
            return true
          default:
            return false
        }
      }).map(mod => this.getRouteModule(mod)),
      renderMode: this.config.ssr ? 'ssr' : 'spa'
    }

    if (bundleMode) {
      return `var bootstrap=__ALEPH.pack["${alephPkgUri}/framework/${framework}/bootstrap.ts"].default;bootstrap(${JSON.stringify(config)})`
    }

    const prefix = alephPkgUri.replace('https://', '').replace('http://localhost:', 'http_localhost_')
    return [
      (this.config.framework === 'react' && this.isDev) && `import "./-/${prefix}/framework/react/refresh.js"`,
      `import bootstrap from "./-/${prefix}/framework/${framework}/bootstrap.js"`,
      `bootstrap(${JSON.stringify(config, undefined, this.isDev ? 4 : undefined)})`
    ].filter(Boolean).join('\n')
  }

  private getDir(name: string, init: () => string) {
    if (this.#dirs.has(name)) {
      return this.#dirs.get(name)!
    }

    const dir = init()
    this.#dirs.set(name, dir)
    return dir
  }

  /** returns the route module by given module. */
  private getRouteModule({ url, hash }: Pick<Module, 'url' | 'hash'>): RouteModule {
    const hasData = this.lookupDeps(url).filter((({ url }) => url.startsWith('#useDeno-'))).length > 0 || undefined
    return { url, hash, hasData }
  }

  private getHTMLScripts() {
    const { baseUrl } = this.config

    if (this.isDev) {
      const mainJS = this.getMainJS()
      return [
        { src: util.cleanPath(`${baseUrl}/_aleph/main.${util.shortHash(computeHash(mainJS))}.js`), type: 'module' },
        { src: util.cleanPath(`${baseUrl}/_aleph/-/deno.land/x/aleph/nomodule.js`), nomodule: true },
      ]
    }

    const mainJS = this.getMainJS(true)
    return [
      { src: util.cleanPath(`${baseUrl}/_aleph/main.bundle.${util.shortHash(computeHash(mainJS))}.js`) },
    ]
  }

  /** fix remote import url to local */
  private toLocalUrl(importUrl: string): string {
    const isRemote = util.isLikelyHttpURL(importUrl)
    if (isRemote) {
      const url = new URL(importUrl)
      let pathname = url.pathname
      let ok = moduleExts.findIndex(ext => pathname.endsWith('.' + ext)) > -1
      if (!ok) {
        for (const plugin of this.config.plugins) {
          if (plugin.type === 'loader' && plugin.test.test(pathname)) {
            ok = true
            break
          }
        }
      }
      let search = Array.from(url.searchParams.entries()).map(([key, value]) => value ? `${key}=${value}` : key)
      if (search.length > 0) {
        pathname += '_' + search.join(',')
      }
      if (!ok) {
        pathname += '.js'
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

  /** apply loaders recurively. */
  private async applyLoader(loader: LoaderPlugin, input: { url: string, content: Uint8Array, map?: Uint8Array }): Promise<Omit<LoaderTransformResult, 'loader'>> {
    const { code, map, loader: next } = await loader.transform(input)
    if (next) {
      const nextLoader = this.config.plugins.find(({ name }) => name === next)
      if (nextLoader && nextLoader.type === 'loader') {
        const encoder = new TextEncoder()
        return this.applyLoader(nextLoader, {
          url: input.url,
          content: encoder.encode(code),
          map: map ? encoder.encode(map) : undefined
        })
      }
    }
    return { code, map }
  }

  /** default compiler options */
  private get defaultCompileOptions(): TransformOptions {
    return {
      importMap: this.importMap,
      alephPkgUri: getAlephPkgUri(),
      reactVersion: this.config.reactVersion,
      isDev: this.isDev,
    }
  }

  /** transpile code without type check. */
  private async transpile(url: string, sourceCode: string, options: TransformOptions) {
    let t: number | null = null
    if (this.#compilerReady === false) {
      t = performance.now()
      this.#compilerReady = initWasm(this.#dirs.get('denoDir')!)
    }
    if (this.#compilerReady instanceof Promise) {
      await this.#compilerReady
      this.#compilerReady = true
    }
    if (t !== null) {
      log.debug(`init compiler wasm in ${Math.round(performance.now() - t)}ms`)
    }

    return transformSync(url, sourceCode, {
      ...options,
      ...this.defaultCompileOptions
    })
  }

  /** download and compile a moudle by given url, then cache on the disk. */
  private async compile(
    url: string,
    options: {
      /* use source code string instead of source from IO */
      sourceCode?: string,
      /* drop pervious complation */
      forceCompile?: boolean,
      /* don't record the complation */
      once?: boolean,
    } = {}
  ): Promise<Module> {
    const { sourceCode, forceCompile, once } = options
    const isRemote = util.isLikelyHttpURL(url)
    const localUrl = this.toLocalUrl(url)
    const name = util.trimModuleExt(path.basename(localUrl))
    const saveDir = path.join(this.buildDir, path.dirname(localUrl))
    const metaFile = path.join(saveDir, `${name}.meta.json`)

    let mod: Module
    if (this.#modules.has(url)) {
      mod = this.#modules.get(url)!
      if (!forceCompile && !sourceCode) {
        return mod
      }
    } else {
      mod = {
        url,
        hash: '',
        sourceHash: '',
        deps: [],
        jsFile: '',
      }
      if (!once) {
        this.#modules.set(url, mod)
      }
      try {
        if (existsFileSync(metaFile)) {
          const { url, sourceHash, deps } = JSON.parse(await Deno.readTextFile(metaFile))
          if (url === url && util.isNEString(sourceHash) && util.isArray(deps)) {
            mod.sourceHash = sourceHash
            mod.deps = deps
          } else {
            log.warn(`removing invalid metadata '${name}.meta.json'`)
            Deno.remove(metaFile)
          }
        }
      } catch (e) { }
    }

    let sourceContent = new Uint8Array()
    let contentType: string | null = null
    let jsContent = ''
    let jsSourceMap: string | null = null
    let shouldCompile = false
    let fsync = false

    if (sourceCode) {
      sourceContent = (new TextEncoder).encode(sourceCode)
      const sourceHash = computeHash(sourceContent)
      if (mod.sourceHash === '' || mod.sourceHash !== sourceHash) {
        mod.sourceHash = sourceHash
        shouldCompile = true
      }
    } else if (isRemote) {
      try {
        const [content, headers] = await this.fetchModule(url)
        const sourceHash = computeHash(content)
        sourceContent = content
        contentType = headers.get('content-type')
        if (mod.sourceHash === '' || mod.sourceHash !== sourceHash) {
          mod.sourceHash = sourceHash
          shouldCompile = true
        }
      } catch (err) {
        log.error(`Download ${url}:`, err)
        return mod
      }
    } else {
      const filepath = path.join(this.srcDir, url)
      try {
        sourceContent = await Deno.readFile(filepath)
        const sourceHash = computeHash(sourceContent)
        if (mod.sourceHash === '' || mod.sourceHash !== sourceHash) {
          mod.sourceHash = sourceHash
          shouldCompile = true
        }
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
          log.error(`local module '${url}' not found`)
          return mod
        }
        throw err
      }
    }

    // compute hash
    mod.hash = computeHash(mod.sourceHash + buildChecksum + JSON.stringify(this.defaultCompileOptions))
    mod.jsFile = util.cleanPath(saveDir + '/' + name + (isRemote ? '' : `.${util.shortHash(mod.hash)}`) + '.js')

    // check previous compilation output if the source content doesn't changed.
    if (!shouldCompile && !existsFileSync(mod.jsFile)) {
      shouldCompile = true
    }

    // compile source code
    if (shouldCompile) {
      let sourceCode = (new TextDecoder).decode(sourceContent)
      let sourceType = path.extname(url).slice(1)

      if (sourceType == 'mjs') {
        sourceType = 'js'
      }
      if (!moduleExts.includes(sourceType) && isRemote) {
        switch (contentType?.split(';')[0].trim()) {
          case 'application/javascript':
          case 'text/javascript':
            sourceType = 'js'
            break
          case 'text/typescript':
            sourceType = 'ts'
            break
          case 'text/jsx':
            sourceType = 'jsx'
            break
          case 'text/tsx':
            sourceType = 'tsx'
            break
        }
      }

      for (const plugin of this.config.plugins) {
        if (plugin.type === 'loader' && plugin.test.test(url)) {
          const { code } = await this.applyLoader(plugin, { url, content: sourceContent })
          sourceCode = code
          sourceType = 'js'
          break
        }
      }

      switch (sourceType) {
        case 'js':
        case 'jsx':
        case 'ts':
        case 'tsx':
          break
        default:
          log.warn(`Unsupported module '${url}'`)
          return mod
      }

      const t = performance.now()
      const { code, map, deps, inlineStyles } = await this.transpile(url, sourceCode, {
        swcOptions: {
          target: 'es2020',
          sourceType
        },
        sourceMap: this.isDev,
      })

      fsync = true
      jsContent = code
      if (map) {
        jsSourceMap = map
      }

      // resolve inline-style
      await Promise.all(Object.entries(inlineStyles).map(async ([key, style]) => {
        let tpl = style.quasis.reduce((tpl, quais, i, a) => {
          tpl += quais
          if (i < a.length - 1) {
            tpl += `%%aleph-inline-style-expr-${i}%%`
          }
          return tpl
        }, '')
          .replace(/\:\s*%%aleph-inline-style-expr-(\d+)%%/g, (_, id) => `: var(--aleph-inline-style-expr-${id})`)
          .replace(/%%aleph-inline-style-expr-(\d+)%%/g, (_, id) => `/*%%aleph-inline-style-expr-${id}%%*/`)
        if (style.type !== 'css') {
          for (const plugin of this.config.plugins) {
            if (plugin.type === 'loader' && plugin.test.test(`.${style.type}`)) {
              const { code, loader } = await plugin.transform({ url, content: (new TextEncoder).encode(tpl) })
              if (loader === 'css-loader') {
                tpl = code
                break
              }
            }
          }
        }
        // todo: postcss and minify
        tpl = tpl.replace(
          /\: var\(--aleph-inline-style-expr-(\d+)\)/g,
          (_, id) => ': ${' + style.exprs[parseInt(id)] + '}'
        ).replace(
          /\/\*%%aleph-inline-style-expr-(\d+)%%\*\//g,
          (_, id) => '${' + style.exprs[parseInt(id)] + '}'
        )
        jsContent = jsContent.replace(`"%%${key}-placeholder%%"`, '`' + tpl + '`')
      }))

      mod.deps = deps.map(({ specifier, isDynamic }) => {
        const dep: DependencyDescriptor = { url: specifier, hash: '' }
        if (isDynamic) {
          dep.isDynamic = true
        }
        if (dep.url.startsWith('#useDeno-')) {
          dep.hash = util.trimPrefix(dep.url, '#useDeno-')
          if (!this.config.ssr) {
            log.warn(`use 'useDeno' hook in SPA mode: ${url}`)
          }
        } else if (dep.url.startsWith('#inline-style-')) {
          dep.hash = util.trimPrefix(dep.url, '#inline-style-')
        }
        return dep
      })

      log.debug(`compile '${url}' in ${Math.round(performance.now() - t)}ms`)
    }

    // compile deps
    for (const dep of mod.deps.filter(({ url }) => !url.startsWith('#'))) {
      const depMod = await this.compile(dep.url, { once })
      if (dep.hash === '' || dep.hash !== depMod.hash) {
        dep.hash = depMod.hash
        if (!util.isLikelyHttpURL(dep.url)) {
          const relativePathname = getRelativePath(
            path.dirname(url),
            util.trimModuleExt(dep.url)
          )
          if (jsContent === '') {
            jsContent = await Deno.readTextFile(mod.jsFile)
          }
          const newContent = jsContent.replace(reHashResolve, (s, key, spaces, ql, importPath, qr) => {
            const importPathname = importPath.replace(reHashJs, '')
            if (importPathname == dep.url || importPathname === relativePathname) {
              return `${key}${spaces}${ql}${importPathname}.${util.shortHash(dep.hash)}.js${qr}`
            }
            return s
          })
          if (newContent !== jsContent) {
            jsContent = newContent
            if (!fsync) {
              fsync = true
            }
          }
        }
      }
    }

    if (fsync) {
      await clearCompilation(mod.jsFile)
      await Promise.all([
        ensureTextFile(mod.jsFile, jsContent + (jsSourceMap ? `//# sourceMappingURL=${path.basename(mod.jsFile)}.map` : '')),
        jsSourceMap ? ensureTextFile(mod.jsFile + '.map', jsSourceMap) : Promise.resolve(),
        ensureTextFile(metaFile, JSON.stringify({
          url,
          sourceHash: mod.sourceHash,
          deps: mod.deps,
        }, undefined, 4)),
      ])
    }

    return mod
  }

  /** create bundle chunks for production. */
  private async bundle() {
    const entryMods = new Set<string>()
    const depMods = new Map<string, boolean>()
    const refCounter = new Map<string, Set<string>>()
    const addDepEntry = (url: string) => {
      depMods.set(url, true)
      this.lookupDeps(url).forEach(({ url }) => !depMods.has(url) && depMods.set(url, false))
    }
    addDepEntry(`${getAlephPkgUri()}/framework/${this.config.framework}/bootstrap.ts`)
    Array.from(this.#modules.values()).forEach(mod => {
      switch (util.trimModuleExt(mod.url)) {
        case '/app':
        case '/404':
          addDepEntry(mod.url)
          break
      }
      Array.from(new Set(mod.deps.map(({ url, isDynamic }) => {
        if (isDynamic) {
          entryMods.add(url)
        }
        return url
      }))).filter(url => !url.startsWith('#')).forEach(url => {
        if (refCounter.has(url)) {
          refCounter.get(url)!.add(mod.url)
        } else {
          refCounter.set(url, new Set([mod.url]))
        }
      })
    })
    this.#pageRouting.lookup(routes => routes.forEach(({ module: { url } }) => entryMods.add(url)))
    refCounter.forEach((refers, url) => {
      const localDepEntryMods = Array.from(depMods.entries()).filter(([url, isEntry]) => !util.isLikelyHttpURL(url) && isEntry).map(([url]) => url)
      const refs = Array.from(refers).filter(url => entryMods.has(url) || localDepEntryMods.includes(url)).length
      if (refs > 1) {
        addDepEntry(url)
      }
    })
    await this.#bundler.bundle(entryMods, depMods)
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
        ...this.getHTMLScripts(),
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

  /** fetch remote module content */
  private async fetchModule(url: string): Promise<[Uint8Array, Headers]> {
    const u = new URL(url)
    if (url.startsWith('https://esm.sh/')) {
      if (this.isDev && !u.searchParams.has('dev')) {
        u.searchParams.set('dev', '')
        u.search = u.search.replace('dev=', 'dev')
      }
    }

    const { protocol, hostname, port, pathname, search } = u
    const versioned = reFullVersion.test(pathname)
    const reload = this.#reloading || !versioned
    const isLocalhost = /^https?:\/\/localhost(:\d+)?\//.test(url)
    const cacheDir = path.join(this.#dirs.get('denoDir')!, 'deps', util.trimSuffix(protocol, ':'), hostname + (port ? '_PORT' + port : ''))
    const hash = createHash('sha256').update(pathname + search).toString()
    const contentFile = path.join(cacheDir, hash)
    const metaFile = path.join(cacheDir, hash + '.metadata.json')

    if (!reload && !isLocalhost && existsFileSync(contentFile) && existsFileSync(metaFile)) {
      const [content, meta] = await Promise.all([
        Deno.readFile(contentFile),
        Deno.readTextFile(metaFile),
      ])
      try {
        const { headers } = JSON.parse(meta)
        return [
          content,
          new Headers(headers)
        ]
      } catch (e) { }
    }

    // download dep when deno cache failed
    let err = new Error('Unknown')
    for (let i = 0; i < 15; i++) {
      if (i === 0) {
        if (!isLocalhost) {
          log.info('Download', url)
        }
      } else {
        log.debug('Download error:', err)
        log.warn(`Download ${url} failed, retrying...`)
      }
      try {
        const resp = await fetch(u.toString())
        if (resp.status >= 400) {
          return Promise.reject(new Error(resp.statusText))
        }
        const buffer = await resp.arrayBuffer()
        const content = await Deno.readAll(new Deno.Buffer(buffer))
        if (!isLocalhost) {
          await ensureDir(cacheDir)
          Deno.writeFile(contentFile, content)
          Deno.writeTextFile(metaFile, JSON.stringify({
            headers: Array.from(resp.headers.entries()).reduce((m, [k, v]) => {
              m[k] = v
              return m
            }, {} as Record<string, string>),
            url
          }, undefined, 4))
        }
        return [content, resp.headers]
      } catch (e) {
        err = e
      }
    }

    return Promise.reject(err)
  }

  /** check compilation side-effect caused by dependency graph changing. */
  private async checkCompilationSideEffect(url: string, callback: (mod: Module) => void) {
    const { hash } = this.#modules.get(url)!

    for (const mod of this.#modules.values()) {
      for (const dep of mod.deps) {
        if (dep.url === url) {
          if (dep.hash !== "" && dep.hash !== hash) {
            dep.hash = hash
            const relativePathname = getRelativePath(
              path.dirname(mod.url),
              util.trimModuleExt(dep.url)
            )
            const jsContent = (await Deno.readTextFile(mod.jsFile))
              .replace(reHashResolve, (s, key, spaces, ql, importPath, qr) => {
                const importPathname = importPath.replace(reHashJs, '')
                if (importPathname === dep.url || importPathname === relativePathname) {
                  return `${key}${spaces}${ql}${importPathname}.${util.shortHash(dep.hash)}.js${qr}`
                }
                return s
              })
            await ensureTextFile(mod.jsFile, jsContent)
            callback(mod)
            log.debug('compilation side-effect:', mod.url, colors.dim('<-'), url)
            this.checkCompilationSideEffect(mod.url, callback)
          }
          break
        }
      }
    }
  }

  /** render page base the given location. */
  private async renderPage(loc: { pathname: string, search?: string }) {
    const start = performance.now()
    const [url, nestedModules] = this.#pageRouting.createRouter(loc)
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
        log.warn(`${colors.bold('404')} '${url.pathname}' not found`)
      }
      return await this.render404Page(url)
    }
    try {
      const appModule = Array.from(this.#modules.values()).find(({ url }) => util.trimModuleExt(url) == '/app')
      const { default: App } = appModule ? await import('file://' + appModule.jsFile) : {} as any
      const imports = nestedModules.map(async ({ url }) => {
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
        await Promise.all(imports)
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
      if (this.isDev) {
        log.info(`render '${url.pathname}' in ${Math.round(performance.now() - start)}ms`)
      }
    } catch (err) {
      ret.status = 500
      ret.head = ['<title>Error 500 - Aleph.js</title>']
      ret.body = `<div id="__aleph"><pre>${colors.stripColor(err.stack)}</pre></div>`
      log.error(err)
    }
    return ret
  }

  /** render custom 404 page. */
  private async render404Page(url = createBlankRouterURL(this.config.defaultLocale)) {
    const ret: RenderResult = {
      url,
      status: 404,
      head: [],
      scripts: [],
      body: '<div id="__aleph"></div>',
      data: null
    }
    try {
      const e404Module = Array.from(this.#modules.keys())
        .filter(url => util.trimModuleExt(url) == '/404')
        .map(url => this.#modules.get(url))[0]
      const { default: E404 } = e404Module ? await import('file://' + e404Module.jsFile) : {} as any
      const { head, body, data, scripts } = await this.#renderer.render(
        url,
        undefined,
        E404,
        []
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
    const loadingModule = Array.from(this.#modules.values()).find(({ url }) => util.trimModuleExt(url) === '/loading')
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
        [{ url: loadingModule.url, Component: Loading }]
      )
      return {
        head,
        body: `<div id="__aleph">${body}</div>`
      } as Pick<RenderResult, 'head' | 'body'>
    }
    return null
  }

  /** check a page whether is able to SSR. */
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
    __deps.push(...mod.deps.filter(({ url }) => __deps.findIndex(d => d.url === url) === -1))
    mod.deps.forEach(({ url }) => this.lookupDeps(url, __deps, __tracing))
    return __deps
  }
}
