import { bold, dim } from 'https://deno.land/std@0.96.0/fmt/colors.ts'
import { indexOf, copy } from 'https://deno.land/std@0.96.0/bytes/mod.ts'
import { ensureDir } from 'https://deno.land/std@0.96.0/fs/ensure_dir.ts'
import { walk } from 'https://deno.land/std@0.96.0/fs/walk.ts'
import { createHash } from 'https://deno.land/std@0.96.0/hash/mod.ts'
import { basename, dirname, extname, join, resolve } from 'https://deno.land/std@0.96.0/path/mod.ts'
import { Bundler, bundlerRuntimeCode, simpleJSMinify } from '../bundler/mod.ts'
import type { TransformOptions } from '../compiler/mod.ts'
import { buildChecksum, parseExportNames, SourceType, transform } from '../compiler/mod.ts'
import { EventEmitter } from '../framework/core/events.ts'
import { moduleExts, toPagePath, trimModuleExt } from '../framework/core/module.ts'
import { Routing } from '../framework/core/routing.ts'
import { ensureTextFile, existsDir, existsFile, lazyRemove } from '../shared/fs.ts'
import log, { Measure } from '../shared/log.ts'
import util from '../shared/util.ts'
import type { ImportMap, RouterURL, ServerApplication } from '../types.ts'
import { VERSION } from '../version.ts'
import type { RequiredConfig } from './config.ts'
import { defaultConfig, fixConfigAndImportMap, isBuiltinCSSLoader, loadConfig, loadImportMap } from './config.ts'
import { cache } from './cache.ts'
import {
  checkAlephDev, checkDenoVersion, clearBuildCache, computeHash,
  getAlephPkgUri, getDenoDir, toRelativePath, getSourceType,
  isLoaderPlugin, isLocalUrl, moduleWalkOptions, toLocalPath
} from './helper.ts'
import { getContentType } from './mime.ts'
import { Renderer } from './ssr.ts'

/** A module includes the compilation details. */
export type Module = {
  url: string
  deps: DependencyDescriptor[]
  external: boolean
  isStyle: boolean
  useDenoHook: boolean,
  hash?: string
  sourceHash: string
  sourceType?: SourceType
  sourceCode?: string
  jsCode?: Uint8Array
  jsFile: string
  ready: Promise<void>
}

/** The dependency descriptor. */
type DependencyDescriptor = {
  url: string
  hash?: string
  isDynamic?: boolean
  hashLoc?: number
}

type Source = {
  code: string
  type: SourceType
  isStyle: boolean
  map?: string
}

type TransformFn = (url: string, code: string) => string

/** The application class for aleph server. */
export class Application implements ServerApplication {
  readonly workingDir: string
  readonly mode: 'development' | 'production'
  readonly buildDir: string
  readonly config: RequiredConfig
  readonly importMap: ImportMap
  readonly ready: Promise<void>

  #modules: Map<string, Module> = new Map()
  #pageRouting: Routing = new Routing({})
  #apiRouting: Routing = new Routing({})
  #fsWatchListeners: Array<EventEmitter> = []
  #bundler: Bundler = new Bundler(this)
  #renderer: Renderer = new Renderer(this)
  #dists: Set<string> = new Set()
  #injects: Map<'compilation' | 'hmr' | 'ssr', TransformFn[]> = new Map()
  #reloading = false

  constructor(
    workingDir = '.',
    mode: 'development' | 'production' = 'production',
    reload = false
  ) {
    checkDenoVersion()
    checkAlephDev()
    this.workingDir = resolve(workingDir)
    this.mode = mode
    this.buildDir = join(this.workingDir, '.aleph', mode)
    this.config = { ...defaultConfig() }
    this.importMap = { imports: {}, scopes: {} }
    this.ready = Deno.env.get('DENO_TESTING') ? Promise.resolve() : this.init(reload)
  }

  /** initiate application */
  private async init(reload: boolean) {
    const ms = new Measure()
    const [config, importMap] = await Promise.all([
      loadConfig(this.workingDir),
      loadImportMap(this.workingDir),
    ])

    Object.assign(this.config, config)
    Object.assign(this.importMap, importMap)
    fixConfigAndImportMap(this.config, this.importMap)

    // load .env files
    for await (const { path: p, } of walk(this.workingDir, { match: [/(^|\/|\\)\.env(\.|$)/i], maxDepth: 1 })) {
      const text = await Deno.readTextFile(p)
      text.split('\n').forEach(line => {
        let [key, value] = util.splitBy(line, '=')
        key = key.trim()
        if (key) {
          Deno.env.set(key, value.trim())
        }
      })
      log.info('load env from', basename(p))
    }

    ms.stop('load config')

    Deno.env.set('ALEPH_VERSION', VERSION)
    Deno.env.set('ALEPH_BUILD_MODE', this.mode)
    Deno.env.set('ALEPH_FRAMEWORK', this.config.framework)

    const alephPkgUri = getAlephPkgUri()
    const srcDir = join(this.workingDir, this.config.srcDir)
    const apiDir = join(srcDir, 'api')
    const pagesDir = join(srcDir, 'pages')
    const buildManifestFile = join(this.buildDir, 'build.manifest.json')
    const plugins = computeHash(JSON.stringify({
      plugins: this.config.plugins.map(({ name }) => name),
      css: {
        modules: this.config.css.modules,
        postcssPlugins: this.config.css.postcss?.plugins.map(p => {
          if (util.isString(p)) {
            return p
          } else if (util.isArray(p)) {
            return p[0]
          } else {
            return 'Plugin'
          }
        })
      },
      react: this.config.react,
    }, (key: string, value: any) => {
      if (key === 'inlineStylePreprocess') {
        return void 0
      }
      return value
    }))
    let shouldRebuild = !await existsFile(buildManifestFile)
    if (!shouldRebuild) {
      try {
        const v = JSON.parse(await Deno.readTextFile(buildManifestFile))
        shouldRebuild = (
          typeof v !== 'object' ||
          v === null ||
          v.compiler !== buildChecksum ||
          v.plugins !== plugins
        )
      } catch (e) { }
    }

    this.#reloading = reload
    if (reload || shouldRebuild) {
      if (await existsDir(this.buildDir)) {
        await Deno.remove(this.buildDir, { recursive: true })
      }
      await ensureDir(this.buildDir)
    }

    if (shouldRebuild) {
      log.debug('rebuild...')
      ensureTextFile(buildManifestFile, JSON.stringify({
        aleph: VERSION,
        deno: Deno.version.deno,
        compiler: buildChecksum,
        plugins,
      }, undefined, 2))
    }

    ms.stop()

    // init framework
    const { init } = await import(`../framework/${this.config.framework}/init.ts`)
    await init(this)

    // compile & import framework renderer
    if (this.config.ssr) {
      const mod = await this.compile(`${alephPkgUri}/framework/${this.config.framework}/renderer.ts`)
      const { render } = await this.importModule(mod)
      if (util.isFunction(render)) {
        this.#renderer.setFrameworkRenderer({ render })
      }
    }

    ms.stop(`init ${this.config.framework} framework`)

    // apply server plugins
    await Promise.all(
      this.config.plugins.map(async plugin => {
        if (plugin.type === 'server') {
          await plugin.setup(this)
        }
      })
    )

    ms.stop('apply plugins')

    const modules: string[] = []
    const apiModules: string[] = []
    const pageModules: string[] = []

    // pre-compile framework modules
    modules.push(`${alephPkgUri}/framework/${this.config.framework}/bootstrap.ts`)
    if (this.isDev) {
      modules.push(`${alephPkgUri}/framework/core/hmr.ts`)
      modules.push(`${alephPkgUri}/framework/core/nomodule.ts`)
    }

    // compile custom components
    for (const name of ['app', '404', 'loading']) {
      for (const ext of moduleExts) {
        if (await existsFile(join(srcDir, `${name}.${ext}`))) {
          modules.push(`/${name}.${ext}`)
          break
        }
      }
    }

    if (await existsDir(apiDir)) {
      for await (const { path: p } of walk(apiDir, { ...moduleWalkOptions, exts: moduleExts })) {
        const url = util.cleanPath('/api/' + util.trimPrefix(p, apiDir))
        apiModules.push(url)
        modules.push(url)
      }
    }

    if (await existsDir(pagesDir)) {
      for await (const { path: p } of walk(pagesDir, moduleWalkOptions)) {
        const url = util.cleanPath('/pages/' + util.trimPrefix(p, pagesDir))
        let validated = moduleExts.some(ext => p.endsWith('.' + ext))
        if (!validated) {
          validated = this.loaders.some(p => p.type === 'loader' && p.test.test(url) && p.allowPage)
        }
        if (validated) {
          pageModules.push(url)
          modules.push(url)
        }
      }
    }

    // wait all compilation tasks are done
    await Promise.all(modules.map(url => this.compile(url)))

    // update routing
    this.#pageRouting.config(this.config)
    apiModules.forEach(url => {
      this.#apiRouting.update(...this.createRouteUpdate(url))
    })
    pageModules.forEach(url => {
      this.#pageRouting.update(...this.createRouteUpdate(url))
    })

    // bundle
    if (!this.isDev) {
      await this.bundle()
    }

    // end reload
    if (reload) {
      this.#reloading = false
    }

    ms.stop('init project')

    if (this.isDev) {
      this.watch()
    }
  }

  /** watch file changes, re-compile modules and send HMR signal. */
  private async watch() {
    const srcDir = join(this.workingDir, this.config.srcDir)
    const w = Deno.watchFs(srcDir, { recursive: true })
    log.info('Start watching code changes...')
    for await (const event of w) {
      for (const p of event.paths) {
        const url = util.cleanPath(util.trimPrefix(p, srcDir))
        if (this.isScopedModule(url)) {
          util.debounceX(url, async () => {
            if (await existsFile(p)) {
              let type = 'modify'
              if (!this.#modules.has(url)) {
                type = 'add'
              } else {
                this.#modules.delete(url)
              }
              log.info(type, url)
              try {
                const module = await this.initModule(url, { forceRefresh: true })
                const hmrable = this.isHMRable(url)
                await this.transpileModule(module, true)
                if (hmrable) {
                  let routePath: string | undefined = undefined
                  let withData: boolean | undefined = undefined
                  let isIndex: boolean | undefined = undefined
                  if (module.url.startsWith('/pages/')) {
                    const [path, _, options] = this.createRouteUpdate(module.url)
                    routePath = path
                    withData = options.withData
                    isIndex = options.isIndex
                  } else {
                    if (['/app', '/404'].includes(trimModuleExt(module.url))) {
                      if (this.hasSSRData(module.url)) {
                        withData = true
                      }
                    }
                  }
                  if (type === 'add') {
                    this.#fsWatchListeners.forEach(e => {
                      e.emit('add', { url: module.url, routePath, isIndex, withData })
                    })
                  } else {
                    this.#fsWatchListeners.forEach(e => {
                      e.emit('modify-' + module.url, { withData })
                    })
                  }
                }
                this.applyCompilationSideEffect(module, ({ url: effectUrl }) => {
                  if (!hmrable && this.isHMRable(effectUrl)) {
                    log.debug('compilation side-effect:', effectUrl, dim('<-'), module.url)
                    this.#fsWatchListeners.forEach(w => w.emit('modify-' + effectUrl))
                  }
                })
              } catch (err) {
                log.error(`compile(${url}):`, err.message)
              }
            } else if (this.#modules.has(url)) {
              if (trimModuleExt(url) === '/app') {
                this.#renderer.clearCache()
              } else if (url.startsWith('/pages/')) {
                const [routePath] = this.createRouteUpdate(url)
                this.#renderer.clearCache(routePath)
                this.#pageRouting.removeRoute(routePath)
              } else if (url.startsWith('/api/')) {
                const [routePath] = this.createRouteUpdate(url)
                this.#apiRouting.removeRoute(routePath)
              }
              this.#modules.delete(url)
              if (this.isHMRable(url)) {
                this.#fsWatchListeners.forEach(e => e.emit('remove', url))
              }
              log.info('remove', url)
            }
          }, 50)
        }
      }
    }
  }

  /** check the changed file whether it is a scoped module that can emit the HMR event. */
  private isScopedModule(url: string) {
    for (const ext of moduleExts) {
      if (url.endsWith('.' + ext)) {
        if (url.startsWith('/pages/') || url.startsWith('/api/')) {
          return true
        }
        switch (trimModuleExt(url)) {
          case '/404':
          case '/app':
            return true
        }
      }
    }

    // is page module by plugin
    if (this.loaders.some(p => p.test.test(url) && p.allowPage)) {
      return true
    }

    // is dep
    for (const { deps } of this.#modules.values()) {
      if (deps.some(dep => dep.url === url)) {
        return true
      }
    }

    return false
  }

  get isDev() {
    return this.mode === 'development'
  }

  get loaders() {
    return this.config.plugins.filter(isLoaderPlugin)
  }

  /** get the module by given url. */
  getModule(url: string): Module | null {
    if (this.#modules.has(url)) {
      return this.#modules.get(url)!
    }
    return null
  }

  /** returns the module of the first one in the modules where predicate is true, and null otherwise.. */
  findModule(predicate: (module: Module) => boolean): Module | null {
    for (const url of this.#modules.keys()) {
      const module = this.#modules.get(url)!
      if (predicate(module)) {
        return module
      }
    }
    return null
  }

  /** get api route by given location. */
  getAPIRoute(location: { pathname: string, search?: string }): [RouterURL, Module] | null {
    const router = this.#apiRouting.createRouter(location)
    if (router !== null) {
      const [url, nestedModules] = router
      if (url.routePath !== '') {
        const { url: moduleUrl } = nestedModules.pop()!
        if (this.#modules.has(moduleUrl)) {
          return [url, this.#modules.get(moduleUrl)!]
        }
      }
    }
    return null
  }

  /** add a module by given path and optional source code. */
  async addModule(url: string, sourceCode?: string): Promise<void> {
    const source = sourceCode ? {
      code: sourceCode,
      type: SourceType.TSX,
      external: false,
      isStyle: false,
    } : undefined
    if (source !== undefined) {
      const type = getSourceType(url)
      if (type !== SourceType.Unknown) {
        source.type = type
      }
    }
    const module = await this.initModule(url, { source })
    await this.transpileModule(module)
    if (url.startsWith('/pages/')) {
      this.#pageRouting.update(...this.createRouteUpdate(url))
    } else if (url.startsWith('/api/')) {
      this.#apiRouting.update(...this.createRouteUpdate(url))
    }
    return
  }

  /** add a dist. */
  async addDist(path: string, content: Uint8Array): Promise<void> {
    const pathname = util.cleanPath(path)
    const savePath = join(this.buildDir, pathname)
    if (!await existsFile(savePath)) {
      const saveDir = dirname(savePath)
      await ensureDir(saveDir)
      await clearBuildCache(savePath, extname(savePath).slice(1))
      await Deno.writeFile(savePath, content)
    }
    this.#dists.add(pathname)
  }

  /** inject code */
  injectCode(stage: 'compilation' | 'hmr' | 'ssr', transform: TransformFn): void {
    if (this.#injects.has(stage)) {
      this.#injects.get(stage)!.push(transform)
    } else {
      this.#injects.set(stage, [transform])
    }
  }

  /** get ssr data */
  async getSSRData(loc: { pathname: string, search?: string }): Promise<any> {
    if (!this.isSSRable(loc.pathname)) {
      return null
    }

    const [router, nestedModules] = this.#pageRouting.createRouter(loc)
    const { routePath } = router
    if (routePath === '') {
      return null
    }

    const path = loc.pathname + (loc.search || '')
    const [_, data] = await this.#renderer.useCache(routePath, path, async () => {
      return await this.#renderer.renderPage(router, nestedModules)
    })
    return data
  }

  /** get ssr page */
  async getPageHTML(loc: { pathname: string, search?: string }): Promise<[number, string]> {
    const [router, nestedModules] = this.#pageRouting.createRouter(loc)
    const { routePath } = router
    const status = routePath !== '' ? 200 : 404
    const path = loc.pathname + (loc.search || '')

    if (!this.isSSRable(loc.pathname)) {
      const [html] = await this.#renderer.useCache('-', 'spa-index', async () => {
        return [await this.#renderer.renderSPAIndexPage(), null]
      })
      return [status, html]
    }

    if (routePath === '') {
      const [html] = await this.#renderer.useCache('404', path, async () => {
        return [await this.#renderer.render404Page(router), null]
      })
      return [status, html]
    }

    const [html] = await this.#renderer.useCache(routePath, path, async () => {
      let [html, data] = await this.#renderer.renderPage(router, nestedModules)
      return [html, data]
    })
    return [status, html]
  }

  /** get code injects */
  getCodeInjects(phase: 'compilation' | 'hmr' | 'ssr') {
    return this.#injects.get(phase)
  }

  /** create a fs watcher.  */
  createFSWatcher(): EventEmitter {
    const e = new EventEmitter()
    this.#fsWatchListeners.push(e)
    return e
  }

  /** remove the fs watcher.  */
  removeFSWatcher(e: EventEmitter) {
    e.removeAllListeners()
    const index = this.#fsWatchListeners.indexOf(e)
    if (index > -1) {
      this.#fsWatchListeners.splice(index, 1)
    }
  }

  /** check the module whether it is hmrable. */
  isHMRable(url: string) {
    if (!this.isDev || util.isLikelyHttpURL(url)) {
      return false
    }

    for (const ext of moduleExts) {
      if (url.endsWith('.' + ext)) {
        return (
          url.startsWith('/pages/') ||
          url.startsWith('/components/') ||
          ['/app', '/404'].includes(util.trimSuffix(url, '.' + ext))
        )
      }
    }

    const mod = this.#modules.get(url)
    if (mod && mod.isStyle) {
      return true
    }

    return this.loaders.some(p => (
      p.test.test(url) &&
      (p.acceptHMR || p.allowPage)
    ))
  }

  /** get main code in javascript. */
  getMainJS(bundleMode = false): string {
    const alephPkgUri = getAlephPkgUri()
    const alephPkgPath = alephPkgUri.replace('https://', '').replace('http://localhost:', 'http_localhost_')
    const { basePath: basePath, defaultLocale, framework } = this.config
    const config: Record<string, any> = {
      basePath,
      defaultLocale,
      locales: [],
      routes: this.#pageRouting.routes,
      rewrites: this.config.rewrites,
      sharedModules: Array.from(this.#modules.values()).filter(({ url }) => {
        return ['/app', '/404'].includes(trimModuleExt(url))
      }).map(({ url }) => {
        let withData: boolean | undefined = undefined
        if (this.config.ssr !== false) {
          if (this.hasSSRData(url)) {
            withData = true
          }
        }
        return { url, withData }
      }),
      renderMode: this.config.ssr ? 'ssr' : 'spa'
    }

    if (bundleMode) {
      return [
        `__ALEPH.basePath = ${JSON.stringify(basePath)};`,
        `__ALEPH.pack["${alephPkgUri}/framework/${framework}/bootstrap.ts"].default(${JSON.stringify(config)});`
      ].join('')
    }

    let code = [
      this.isDev && `import { connect } from "./-/${alephPkgPath}/framework/core/hmr.js";`,
      `import bootstrap from "./-/${alephPkgPath}/framework/${framework}/bootstrap.js";`,
      this.isDev && `connect(${JSON.stringify(basePath)});`,
      `bootstrap(${JSON.stringify(config, undefined, this.isDev ? 2 : undefined)});`
    ].filter(Boolean).join('\n')
    this.#injects.get('compilation')?.forEach(transform => {
      code = transform('/main.js', code)
    })
    return code
  }

  /** get ssr html scripts */
  getSSRHTMLScripts(entryFile?: string) {
    const { framework } = this.config
    const basePath = util.trimSuffix(this.config.basePath, '/')
    const alephPkgPath = getAlephPkgUri().replace('https://', '').replace('http://localhost:', 'http_localhost_')

    if (this.isDev) {
      const preload: string[] = [
        `/framework/core/module.js`,
        `/framework/core/events.js`,
        `/framework/core/routing.js`,
        `/framework/core/hmr.js`,
        `/framework/${framework}/bootstrap.js`,
        `/shared/util.js`,
      ].map(p => `${basePath}/_aleph/-/${alephPkgPath}${p}`)

      Array.from(this.#modules.keys()).forEach(url => {
        switch (trimModuleExt(url)) {
          case '/app':
            preload.push(`${basePath}/_aleph/app.js`)
            break
          case '/404':
            preload.push(`${basePath}/_aleph/404.js`)
            break
        }
      })

      if (entryFile) {
        preload.push(`${basePath}/_aleph${entryFile}`)
      }

      return [
        ...preload.map(src => ({ src, type: 'module', preload: true })),
        { src: `${basePath}/_aleph/main.js`, type: 'module' },
        { src: `${basePath}/_aleph/-/${alephPkgPath}/nomodule.js`, nomodule: true },
      ]
    }

    return [
      simpleJSMinify(bundlerRuntimeCode),
      ...['polyfills', 'deps', 'shared', 'main', entryFile ? util.trimSuffix(entryFile, '.js') : '']
        .filter(name => name !== "" && this.#bundler.getBundledFile(name) !== null)
        .map(name => ({
          src: `${basePath}/_aleph/${this.#bundler.getBundledFile(name)}`
        }))
    ]
  }

  /** parse the export names of the module. */
  async parseModuleExportNames(url: string): Promise<string[]> {
    const { content, contentType } = await this.fetch(url)
    const sourceType = getSourceType(url, contentType || undefined)
    if (sourceType === SourceType.Unknown || sourceType === SourceType.CSS) {
      return []
    }
    const code = (new TextDecoder).decode(content)
    const names = await parseExportNames(url, code, { sourceType })
    return (await Promise.all(names.map(async name => {
      if (name.startsWith('{') && name.startsWith('}')) {
        return await this.parseModuleExportNames(name.slice(1, -1))
      }
      return name
    }))).flat()
  }

  /** common compiler options */
  get commonCompileOptions(): TransformOptions {
    return {
      alephPkgUri: getAlephPkgUri(),
      importMap: this.importMap,
      inlineStylePreprocess: async (key: string, type: string, tpl: string) => {
        if (type !== 'css') {
          for (const loader of this.loaders) {
            if (loader.test.test(`.${type}`) && loader.load) {
              const { code, type } = await loader.load({ url: key, data: (new TextEncoder).encode(tpl) }, this)
              if (type === 'css') {
                tpl = code
              }
            }
          }
        }
        for (const loader of this.loaders) {
          if (loader.test.test('.css') && loader.load) {
            const { code, type } = await loader.load({ url: key, data: (new TextEncoder).encode(tpl) }, this)
            if (type === 'css') {
              return code
            }
          }
        }
        return tpl
      },
      isDev: this.isDev,
      react: this.config.react,
    }
  }

  async analyze(): Promise<void> {
    await this.ready
    this.#modules.size
    console.log('todo: analyze deps...')
  }

  /** build the application to a static site(SSG) */
  async build() {
    const start = performance.now()

    // wait for app ready
    await this.ready

    const outputDir = join(this.workingDir, this.config.outputDir)
    const distDir = join(outputDir, '_aleph')

    // clear previous build
    if (await existsDir(outputDir)) {
      for await (const entry of Deno.readDir(outputDir)) {
        await Deno.remove(join(outputDir, entry.name), { recursive: entry.isDirectory })
      }
    }

    if (this.#dists.size > 0) {
      Promise.all(Array.from(this.#dists.values()).map(async path => {
        const src = join(this.buildDir, path)
        if (await existsFile(src)) {
          const dest = join(distDir, path)
          await ensureDir(dirname(dest))
          return Deno.copyFile(src, dest)
        }
      }))
    }

    // copy bundle dist
    await this.#bundler.copyDist()

    // ssg
    await this.ssg()

    // copy public assets
    const publicDir = join(this.workingDir, 'public')
    if (await existsDir(publicDir)) {
      for await (const { path: p } of walk(publicDir, { includeDirs: false, skip: [/(^|\/|\\)\./] })) {
        const rp = util.trimPrefix(p, publicDir)
        const fp = join(outputDir, rp)
        await ensureDir(dirname(fp))
        await Deno.copyFile(p, fp)
      }
    }

    log.info(`Done in ${Math.round(performance.now() - start)}ms`)
  }

  private createRouteUpdate(url: string): [string, string, { isIndex?: boolean, withData?: boolean }] {
    const isBuiltinModule = moduleExts.some(ext => url.endsWith('.' + ext))
    let routePath = isBuiltinModule ? toPagePath(url) : util.trimSuffix(url, '/pages')
    let withData: boolean | undefined = undefined
    let isIndex: boolean | undefined = undefined

    if (this.config.ssr !== false && !url.startsWith('/api/')) {
      if (this.hasSSRData(url)) {
        withData = true
      }
    }

    if (!isBuiltinModule) {
      for (const loader of this.loaders) {
        if (loader.test.test(url) && loader.allowPage && loader.resolve) {
          const { pagePath, isIndex: _isIndex } = loader.resolve(url)
          if (util.isNEString(pagePath)) {
            routePath = pagePath
            if (!!_isIndex) {
              isIndex = true
            }
            break
          }
        }
      }
    } else if (routePath !== '/') {
      for (const ext of moduleExts) {
        if (url.endsWith('/index.' + ext)) {
          isIndex = true
          break
        }
      }
    }

    return [routePath, url, { isIndex, withData }]
  }

  /** fetch resource by the url. */
  async fetch(url: string): Promise<{ content: Uint8Array, contentType: string | null }> {
    if (!util.isLikelyHttpURL(url)) {
      const filepath = join(this.workingDir, this.config.srcDir, util.trimPrefix(url, 'file://'))
      if (await existsFile(filepath)) {
        const content = await Deno.readFile(filepath)
        return { content, contentType: getContentType(filepath) }
      } else {
        return Promise.reject(new Error(`No such file`))
      }
    }

    // append `dev` query for development mode
    if (this.isDev && url.startsWith('https://esm.sh/')) {
      const u = new URL(url)
      if (!u.searchParams.has('dev')) {
        u.searchParams.set('dev', '')
        u.search = u.search.replace('dev=', 'dev')
        url = u.toString()
      }
    }

    return await cache(url, {
      forceRefresh: this.#reloading,
      retryTimes: 10
    })
  }

  async importModule({ jsFile, hash, sourceHash }: Module): Promise<any> {
    return await import(`file://${join(this.buildDir, jsFile)}#${(hash || sourceHash).slice(0, 6)}`)
  }

  async getModuleJSCode(module: Module): Promise<Uint8Array | null> {
    const { jsFile, jsCode } = module
    if (jsCode) {
      return jsCode
    }

    const cacheFilePath = join(this.buildDir, jsFile)
    if (await existsFile(cacheFilePath)) {
      const content = await Deno.readFile(cacheFilePath)
      module.jsCode = content
      log.debug(`read cached '${jsFile}'` + dim(' • ' + util.formatBytes(content.length)))
      return content
    }

    return null
  }

  async loadModule(url: string, data?: any): Promise<Source> {
    let sourceCode: string = ''
    let sourceType: SourceType = SourceType.Unknown
    let sourceMap: string | null = null
    let loader = this.loaders.find(l => l.test.test(url))
    let isStyle = loader !== undefined && isBuiltinCSSLoader(loader)

    if (loader && util.isFunction(loader.load)) {
      const { code, type = 'js', map } = await loader.load({ url, data }, this)
      switch (type) {
        case 'js':
          sourceType = SourceType.JS
          break
        case 'jsx':
          sourceType = SourceType.JSX
          break
        case 'ts':
          sourceType = SourceType.TS
          break
        case 'tsx':
          sourceType = SourceType.TSX
          break
        case 'css':
          sourceType = SourceType.CSS
          break
      }
      sourceCode = code
      sourceMap = map || null
    } else {
      const source = await this.fetch(url)
      sourceType = getSourceType(url, source.contentType || undefined)
      if (sourceType !== SourceType.Unknown) {
        sourceCode = (new TextDecoder).decode(source.content)
      }
    }

    if (sourceType === SourceType.CSS) {
      isStyle = true
      for (const loader of this.loaders) {
        if (loader.test.test('.css') && util.isFunction(loader.load)) {
          // todo: covert source map
          const { code, type = 'js' } = await loader.load({ url, data: sourceCode }, this)
          if (type === 'js') {
            sourceCode = code
            sourceType = SourceType.JS
          }
        }
      }
    }

    return {
      code: sourceCode,
      type: sourceType,
      isStyle,
      map: sourceMap ? sourceMap : undefined
    }
  }

  /** compile the module by given url */
  private async compile(url: string) {
    const module = await this.initModule(url)
    await this.transpileModule(module)
    return module
  }

  private async initModule(url: string, { source, forceRefresh }: { source?: Source, forceRefresh?: boolean } = {}): Promise<Module> {
    let external = false
    let data: any = null

    if (source === undefined) {
      for (const l of this.loaders) {
        if (util.isFunction(l.resolve) && l.test.test(url)) {
          const ret = l.resolve(url)
          url = ret.url
          external = Boolean(ret.external)
          data = ret.data
          break
        }
      }
    }

    if (external) {
      return {
        url,
        deps: [],
        external,
        isStyle: false,
        useDenoHook: false,
        sourceHash: '',
        jsFile: '',
        ready: Promise.resolve()
      }
    }

    let mod = this.#modules.get(url)
    if (mod && !forceRefresh) {
      await mod.ready
      return mod
    }

    const isRemote = util.isLikelyHttpURL(url) && !isLocalUrl(url)
    const localUrl = toLocalPath(url)
    const name = trimModuleExt(basename(localUrl))
    const jsFile = join(dirname(localUrl), `${name}.js`)
    const cacheFilepath = join(this.buildDir, jsFile)
    const metaFilepath = cacheFilepath.slice(0, -3) + '.meta.json'

    let defer = (err?: Error) => { }
    mod = {
      url,
      deps: [],
      external: false,
      isStyle: false,
      useDenoHook: false,
      sourceHash: '',
      jsFile,
      ready: new Promise((resolve, reject) => {
        defer = (err?: Error) => {
          if (err) {
            this.#modules.delete(url)
            reject(err)
          } else {
            resolve()
          }
        }
      })
    }
    this.#modules.set(url, mod)

    if (isRemote && !this.#reloading) {
      if (!await existsFile(metaFilepath) || !await existsFile(cacheFilepath)) {
        const globalCacheFilepath = join(await getDenoDir(), 'gen/aleph', jsFile)
        const globalMetaFilepath = globalCacheFilepath.slice(0, -3) + '.meta.json'
        if (await existsFile(globalCacheFilepath) && await existsFile(globalMetaFilepath)) {
          await ensureDir(dirname(cacheFilepath))
          await Promise.all([
            Deno.copyFile(globalCacheFilepath, cacheFilepath),
            Deno.copyFile(globalMetaFilepath, metaFilepath)
          ])
        }
      }
    }

    if (await existsFile(metaFilepath)) {
      try {
        const { url: _url, sourceHash, deps, isStyle, useDenoHook } = JSON.parse(await Deno.readTextFile(metaFilepath))
        if (_url === url && util.isNEString(sourceHash) && util.isArray(deps)) {
          mod.sourceHash = sourceHash
          mod.deps = deps
          mod.isStyle = Boolean(isStyle)
          mod.useDenoHook = Boolean(useDenoHook)
        } else {
          log.warn(`removing invalid metadata '${name}.meta.json'`)
          Deno.remove(metaFilepath)
        }
      } catch (e) { }
    }

    const shouldLoad = !(
      (isRemote && !this.#reloading && mod.sourceHash !== '') &&
      await existsFile(cacheFilepath)
    )
    if (shouldLoad) {
      try {
        const { code, type, isStyle } = source || await this.loadModule(url, data)
        const sourceHash = computeHash(code)
        if (mod.sourceHash !== sourceHash) {
          mod.sourceCode = code
          mod.sourceType = type
          mod.sourceHash = sourceHash
        }
        mod.isStyle = isStyle
      } catch (err) {
        defer(err)
        log.error(`Load module '${url}':`, err.message)
        return mod
      }
    }

    defer()
    return mod
  }

  private async transpileModule(module: Module, ignoreDeps = false, __tracing: Set<string> = new Set()): Promise<void> {
    const { url, sourceType, sourceCode, jsFile } = module

    // ensure the module only be transppiled once in current compilation context,
    // to avoid dead-loop caused by cicular imports
    if (__tracing.has(url)) {
      return
    }
    __tracing.add(url)

    if (sourceType !== undefined && sourceCode !== undefined) {
      if (sourceType === SourceType.Unknown) {
        log.error(`Unsupported module '${url}'`)
        return
      }

      delete module.sourceType
      delete module.sourceCode

      const ms = new Measure()
      const encoder = new TextEncoder()
      const { code, deps, useDenoHooks, starExports, map } = await transform(url, sourceCode, {
        ...this.commonCompileOptions,
        sourceMap: this.isDev,
        swcOptions: {
          sourceType
        },
      })

      let jsCode = code

      // in production/bundle mode we need to replace the star export with names
      if (starExports && starExports.length > 0) {
        for (let index = 0; index < starExports.length; index++) {
          const exportUrl = starExports[index]
          const names = await this.parseModuleExportNames(exportUrl)
          jsCode = jsCode.replace(`export * from "[${exportUrl}]:`, `export {${names.filter(name => name !== 'default').join(',')}} from "`)
        }
      }

      // revert external imports
      if (this.loaders.length > 0) {
        deps.forEach(({ specifier }) => {
          if (specifier !== module.url && util.isLikelyHttpURL(specifier)) {
            let external = false
            for (const l of this.loaders) {
              if (util.isFunction(l.resolve) && l.test.test(specifier)) {
                const ret = l.resolve(specifier)
                external = Boolean(ret.external)
                specifier = ret.url
                break
              }
            }
            if (external) {
              const importUrl = toRelativePath(
                dirname(toLocalPath(module.url)),
                toLocalPath(specifier)
              )
              jsCode.replaceAll(`"${importUrl}"`, `"${specifier}"`)
            }
          }
        })
      }

      // add source mapping url
      if (map) {
        jsCode += `\n//# sourceMappingURL=${basename(jsFile)}.map`
      }

      module.jsCode = encoder.encode(jsCode)
      module.deps = deps.filter(({ specifier }) => specifier != module.url).map(({ specifier, isDynamic, importIndex }) => {
        const dep: DependencyDescriptor = { url: specifier }
        if (isDynamic) {
          dep.isDynamic = true
        }
        if (specifier.startsWith('/')) {
          const mark = encoder.encode(`.js#${specifier}@${importIndex}`)
          const idx = indexOf(module.jsCode!, mark)
          if (idx > 0) {
            dep.hashLoc = idx + mark.length - importIndex.length
          }
        }
        return dep
      })
      if (useDenoHooks && useDenoHooks.length > 0) {
        module.useDenoHook = true
        if (!this.config.ssr) {
          log.error(`'useDeno' hook in SPA mode is illegal: ${url}`)
        }
      }

      ms.stop(`transpile '${url}'`)

      const cacheFilepath = join(this.buildDir, jsFile)
      const metaFilepath = cacheFilepath.slice(0, -3) + '.meta.json'
      const metaJSON = JSON.stringify({
        url,
        sourceHash: module.sourceHash,
        isStyle: module.isStyle ? true : undefined,
        useDenoHook: module.useDenoHook ? true : undefined,
        deps: module.deps,
      }, undefined, 2)
      await ensureDir(dirname(cacheFilepath))
      await Promise.all([
        Deno.writeFile(cacheFilepath, module.jsCode),
        Deno.writeTextFile(metaFilepath, metaJSON),
        map ? Deno.writeTextFile(`${cacheFilepath}.map`, map) : Promise.resolve(),
      ])
      if (util.isLikelyHttpURL(url) && !isLocalUrl(url)) {
        const globalCacheFilepath = join(await getDenoDir(), 'gen/aleph', jsFile)
        const globalMetaFilepath = globalCacheFilepath.slice(0, -3) + '.meta.json'
        await ensureDir(dirname(globalCacheFilepath))
        await Promise.all([
          Deno.writeFile(globalCacheFilepath, module.jsCode),
          Deno.writeTextFile(globalMetaFilepath, metaJSON),
        ])
      }
    }

    if (ignoreDeps) {
      return
    }

    if (module.deps.length > 0) {
      const encoder = new TextEncoder()
      const hasher = createHash('md5').update(module.sourceHash)
      let fsync = false
      await Promise.all(module.deps.map(async dep => {
        const { url, hash: prevHash, hashLoc } = dep
        const depModule = await this.initModule(url)
        if (!depModule.external) {
          await this.transpileModule(depModule, false, __tracing)
        }
        const hash = depModule.hash || depModule.sourceHash
        if (hashLoc && prevHash !== hash) {
          const jsCode = await this.getModuleJSCode(module)
          dep.hash = hash
          if (jsCode) {
            const hashData = encoder.encode((hash).substr(0, 6))
            copy(hashData, jsCode, hashLoc)
          }
          if (!fsync) {
            fsync = true
          }
        }
        hasher.update(hash)
      }))

      module.hash = hasher.toString()
      if (fsync) {
        await this.cacheModule(module)
      }
    } else {
      module.hash = module.sourceHash
    }
  }

  /** apply compilation side-effect caused by dependency graph updating. */
  private async applyCompilationSideEffect(by: Module, callback: (mod: Module) => void) {
    const hash = by.hash || by.sourceHash
    const hashData = (new TextEncoder()).encode(hash.substr(0, 6))
    this.applyModuleSideEffect(by.url)
    for (const mod of this.#modules.values()) {
      const { deps } = mod
      if (deps.length > 0) {
        let fsync = false
        for (const dep of deps) {
          const { url, hash: prevHash, hashLoc } = dep
          if (url === by.url && hashLoc && prevHash !== hash) {
            const jsCode = await this.getModuleJSCode(mod)
            dep.hash = hash
            if (jsCode) {
              copy(hashData, jsCode, hashLoc)
            }
            if (!fsync) {
              fsync = true
            }
          }
        }
        if (fsync) {
          const hasher = createHash('md5').update(mod.sourceHash)
          deps.forEach(({ url }) => {
            const depMod = url === by.url ? by : this.#modules.get(url)
            if (depMod) {
              hasher.update(depMod.hash || depMod.sourceHash)
            }
          })
          mod.hash = hasher.toString()
          await this.cacheModule(mod)
          this.applyModuleSideEffect(mod.url)
          callback(mod)
          await this.applyCompilationSideEffect(mod, callback)
        }
      }
    }
  }

  private applyModuleSideEffect(url: string) {
    if (trimModuleExt(url) === '/app') {
      this.#renderer.clearCache()
    } else if (url.startsWith('/pages/')) {
      const [routePath] = this.createRouteUpdate(url)
      this.#renderer.clearCache(routePath)
      this.#pageRouting.update(...this.createRouteUpdate(url))
    } else if (url.startsWith('/api/')) {
      this.#apiRouting.update(...this.createRouteUpdate(url))
    }
  }

  private async cacheModule(module: Module) {
    const { url, jsCode, jsFile } = module
    if (jsCode) {
      const cacheFilepath = join(this.buildDir, jsFile)
      const metaFilepath = cacheFilepath.slice(0, -3) + '.meta.json'
      await ensureDir(dirname(cacheFilepath))
      await Promise.all([
        Deno.writeFile(cacheFilepath, jsCode),
        Deno.writeTextFile(metaFilepath, JSON.stringify({
          url,
          sourceHash: module.sourceHash,
          isStyle: module.isStyle ? true : undefined,
          useDenoHook: module.useDenoHook ? true : undefined,
          deps: module.deps,
        }, undefined, 2)),
        lazyRemove(cacheFilepath.slice(0, -3) + '.client.js'),
      ])
    }
  }

  /** create bundle chunks for production. */
  private async bundle() {
    const sharedEntryMods = new Set<string>()
    const entryMods = new Map<string[], boolean>()
    const refCounter = new Set<string>()
    const concatAllEntries = () => [
      Array.from(entryMods.entries()).map(([urls, shared]) => urls.map(url => ({ url, shared }))),
      Array.from(sharedEntryMods).map(url => ({ url, shared: true })),
    ].flat(2)

    // add framwork bootstrap module as shared entry
    entryMods.set(
      [`${getAlephPkgUri()}/framework/${this.config.framework}/bootstrap.ts`],
      true
    )

    // add app/404 modules as shared entry
    entryMods.set(Array.from(this.#modules.keys()).filter(url => ['/app', '/404'].includes(trimModuleExt(url))), true)

    // add page module entries
    this.#pageRouting.lookup(routes => {
      routes.forEach(({ module: { url } }) => entryMods.set([url], false))
    })

    // add dynamic imported module as entry
    this.#modules.forEach(mod => {
      mod.deps.forEach(({ url, isDynamic }) => {
        if (isDynamic) {
          entryMods.set([url], false)
        }
        return url
      })
    })

    for (const mods of entryMods.keys()) {
      const deps = new Set<string>()
      mods.forEach(url => {
        this.lookupDeps(url, dep => {
          if (!dep.isDynamic) {
            deps.add(dep.url)
          }
        })
      })
      deps.forEach(url => {
        if (refCounter.has(url)) {
          sharedEntryMods.add(url)
        } else {
          refCounter.add(url)
        }
      })
    }

    await this.#bundler.bundle(concatAllEntries())
  }

  /** render all pages in routing. */
  private async ssg() {
    const { ssr } = this.config
    const outputDir = join(this.workingDir, this.config.outputDir)

    if (ssr === false) {
      const html = await this.#renderer.renderSPAIndexPage()
      await ensureTextFile(join(outputDir, 'index.html'), html)
      await ensureTextFile(join(outputDir, '404.html'), html)
      return
    }

    log.info(bold('- Pages (SSG)'))

    // render pages
    const paths = new Set(this.#pageRouting.paths)
    // todo: check getStaticPaths
    await Promise.all(Array.from(paths).map(async pathname => {
      if (this.isSSRable(pathname)) {
        const [router, nestedModules] = this.#pageRouting.createRouter({ pathname })
        if (router.routePath !== '') {
          let [html, data] = await this.#renderer.renderPage(router, nestedModules)
          this.#injects.get('ssr')?.forEach(transform => {
            html = transform(pathname, html)
          })
          await ensureTextFile(join(outputDir, pathname, 'index.html'), html)
          if (data) {
            const dataFile = join(
              outputDir,
              `_aleph/data/${util.btoaUrl(pathname)}.json`
            )
            await ensureTextFile(dataFile, JSON.stringify(data))
          }
          log.info('  ○', pathname, dim('• ' + util.formatBytes(html.length)))
        } else {
          log.error('Page not found:', pathname)
        }
      }
    }))

    // render 404 page
    {
      const [router] = this.#pageRouting.createRouter({ pathname: '/404' })
      let html = await this.#renderer.render404Page(router)
      this.#injects.get('ssr')?.forEach(transform => {
        html = transform('/404', html)
      })
      await ensureTextFile(join(outputDir, '404.html'), html)
    }
  }

  /** check the page whether it supports SSR. */
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

  private hasSSRData(url: string) {
    let hasData = false
    if (this.getModule(url)?.useDenoHook) {
      hasData = true
    } else {
      this.lookupDeps(url, dep => {
        if (this.getModule(dep.url)?.useDenoHook) {
          hasData = true
          return false
        }
      })
    }
    return hasData
  }

  /** lookup app deps recurively. */
  lookupDeps(
    url: string,
    callback: (dep: DependencyDescriptor) => false | void,
    __tracing: Set<string> = new Set()
  ) {
    const mod = this.getModule(url)
    if (mod === null) {
      return
    }
    if (__tracing.has(url)) {
      return
    }
    __tracing.add(url)
    for (const dep of mod.deps) {
      if (callback(dep) === false) {
        return false
      }
    }
    for (const { url } of mod.deps) {
      if ((this.lookupDeps(url, callback, __tracing)) === false) {
        return false
      }
    }
  }
}
