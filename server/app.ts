import { bold, dim } from 'https://deno.land/std@0.94.0/fmt/colors.ts'
import { ensureDir } from 'https://deno.land/std@0.94.0/fs/ensure_dir.ts'
import { walk } from 'https://deno.land/std@0.94.0/fs/walk.ts'
import {
  basename,
  dirname,
  extname,
  join,
  resolve
} from 'https://deno.land/std@0.94.0/path/mod.ts'
import { Bundler, bundlerRuntimeCode, simpleJSMinify } from '../bundler/mod.ts'
import {
  buildChecksum,
  parseExportNames,
  SourceType,
  transform,
  TransformOptions
} from '../compiler/mod.ts'
import { EventEmitter } from '../framework/core/events.ts'
import { moduleExts, toPagePath, trimModuleExt } from '../framework/core/module.ts'
import { RouteModule, Routing } from '../framework/core/routing.ts'
import { minDenoVersion } from '../shared/constants.ts'
import {
  ensureTextFile,
  existsDirSync,
  existsFileSync,
  lazyRemove
} from '../shared/fs.ts'
import log, { Measure } from '../shared/log.ts'
import util from '../shared/util.ts'
import type {
  ImportMap,
  RouterURL,
  ServerPluginContext,
} from '../types.ts'
import { VERSION } from '../version.ts'
import {
  defaultConfig,
  loadConfig,
  loadAndUpgradeImportMap,
  RequiredConfig
} from './config.ts'
import { cache } from './cache.ts'
import { CSSProcessor } from './css.ts'
import {
  checkAlephDev,
  computeHash,
  formatBytesWithColor,
  getAlephPkgUri,
  getRelativePath,
  isLoaderPlugin,
  moduleWalkOptions,
  reFullVersion,
  toLocalUrl
} from './helper.ts'
import { Renderer } from './ssr.ts'

/** A module includes the compilation details. */
export type Module = {
  url: string
  deps: DependencyDescriptor[]
  isStyle: boolean
  sourceHash: string
  hash: string
  jsFile: string
  ready: Promise<void>
}

/** The dependency descriptor. */
export type DependencyDescriptor = {
  url: string
  hash: string
  isDynamic?: boolean
}

type TransformFn = (url: string, code: string) => string

/** The application class for aleph server. */
export class Application implements ServerPluginContext {
  readonly workingDir: string
  readonly mode: 'development' | 'production'
  readonly config: RequiredConfig
  readonly importMap: ImportMap
  readonly ready: Promise<void>

  #modules: Map<string, Module> = new Map()
  #pageRouting: Routing = new Routing({})
  #apiRouting: Routing = new Routing({})
  #fsWatchListeners: Array<EventEmitter> = []
  #cssProcesser: CSSProcessor = new CSSProcessor()
  #bundler: Bundler = new Bundler(this)
  #renderer: Renderer = new Renderer(this)
  #injects: Map<'compilation' | 'hmr' | 'ssr', TransformFn[]> = new Map()
  #reloading = false

  constructor(
    workingDir = '.',
    mode: 'development' | 'production' = 'production',
    reload = false
  ) {
    if (Deno.version.deno < minDenoVersion) {
      log.error(`Aleph.js needs Deno ${minDenoVersion}+, please upgrade Deno.`)
      Deno.exit(1)
    }
    checkAlephDev()
    this.workingDir = resolve(workingDir)
    this.mode = mode
    this.config = { ...defaultConfig }
    this.importMap = { imports: {}, scopes: {} }
    this.ready = this.init(reload)
  }

  /** initiate application */
  private async init(reload: boolean) {
    const ms = new Measure()
    const [config, importMap] = await Promise.all([
      loadConfig(this.workingDir),
      loadAndUpgradeImportMap(this.workingDir),
    ])

    Object.assign(this.config, config)
    Object.assign(this.importMap, importMap)
    this.#pageRouting.config(this.config)
    this.#cssProcesser.config(!this.isDev, this.config.css)

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
    Deno.env.set('ALEPH_FRAMEWORK', this.framework)

    const alephPkgUri = getAlephPkgUri()
    const compileTasks: Array<Promise<Module>> = []
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
    let shouldRebuild = !existsFileSync(buildManifestFile)
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
      if (existsDirSync(this.buildDir)) {
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
    const { init } = await import(`../framework/${this.framework}/init.ts`)
    await init(this)

    ms.stop('init framework')

    // apply server plugins
    await Promise.all(
      this.config.plugins.map(async plugin => {
        if (plugin.type === 'server') {
          await plugin.setup(this)
        }
      })
    )

    ms.stop('apply plugins')

    // compile & import framework renderer
    if (this.config.ssr) {
      compileTasks.push((async () => {
        const mod = await this.compile(`${alephPkgUri}/framework/${this.framework}/renderer.ts`)
        const { render } = await import(`file://${mod.jsFile}`)
        if (util.isFunction(render)) {
          this.#renderer.setFrameworkRenderer({ render })
        }
        return mod
      })())
    }

    // pre-compile framework modules
    compileTasks.push(this.compile(`${alephPkgUri}/framework/${this.framework}/bootstrap.ts`))
    if (this.isDev) {
      compileTasks.push(this.compile(`${alephPkgUri}/framework/core/hmr.ts`))
      compileTasks.push(this.compile(`${alephPkgUri}/framework/core/nomodule.ts`))
    }

    // compile custom components
    for (const name of ['app', '404', 'loading']) {
      for (const ext of moduleExts) {
        if (existsFileSync(join(this.srcDir, `${name}.${ext}`))) {
          compileTasks.push(this.compile(`/${name}.${ext}`))
          break
        }
      }
    }

    const apiModules: string[] = []
    const pageModules: string[] = []
    const apiDir = join(this.srcDir, 'api')
    const pagesDir = join(this.srcDir, 'pages')

    if (existsDirSync(apiDir)) {
      for await (const { path: p } of walk(apiDir, { ...moduleWalkOptions, exts: moduleExts })) {
        const url = util.cleanPath('/api/' + util.trimPrefix(p, apiDir))
        apiModules.push(url)
        compileTasks.push(this.compile(url))
      }
    }

    if (existsDirSync(pagesDir)) {
      for await (const { path: p } of walk(pagesDir, moduleWalkOptions)) {
        const url = util.cleanPath('/pages/' + util.trimPrefix(p, pagesDir))
        let validated = moduleExts.some(ext => p.endsWith('.' + ext))
        if (!validated) {
          validated = this.loaders.some(p => p.type === 'loader' && p.test.test(url) && p.allowPage)
        }
        if (validated) {
          pageModules.push(url)
          compileTasks.push(this.compile(url))
        }
      }
    }

    log.info('Compiling...')

    // wait all compilation tasks are done
    await Promise.all(compileTasks)

    // update routing
    apiModules.forEach(url => {
      this.#apiRouting.update(...this.createRouteUpdate(url))
    })
    pageModules.forEach(url => {
      this.#pageRouting.update(...this.createRouteUpdate(url))
    })

    // pre-bundle
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
    const w = Deno.watchFs(this.srcDir, { recursive: true })
    log.info('Start watching code changes...')
    for await (const event of w) {
      for (const p of event.paths) {
        const url = util.cleanPath(util.trimPrefix(p, this.srcDir))
        if (this.isScopedModule(url)) {
          util.debounceX(url, () => {
            if (existsFileSync(p)) {
              let type = 'modify'
              if (!this.#modules.has(url)) {
                type = 'add'
              }
              log.info(type, url)
              this.compile(url, { forceCompile: true }).then(mod => {
                const hmrable = this.isHMRable(mod.url)
                const applyEffect = (url: string) => {
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
                if (hmrable) {
                  let routePath: string | undefined = undefined
                  let useDeno: boolean | undefined = undefined
                  let isIndex: boolean | undefined = undefined
                  if (mod.url.startsWith('/pages/')) {
                    const [path, _, options] = this.createRouteUpdate(mod.url)
                    routePath = path
                    useDeno = options.useDeno
                    isIndex = options.isIndex
                  } else {
                    if (['/app', '/404'].includes(trimModuleExt(mod.url))) {
                      this.lookupDeps(mod.url, dep => {
                        if (dep.url.startsWith('#useDeno-')) {
                          useDeno = true
                          return false
                        }
                      })
                    }
                  }
                  if (type === 'add') {
                    this.#fsWatchListeners.forEach(e => {
                      e.emit('add', { url: mod.url, routePath, isIndex, useDeno })
                    })
                  } else {
                    this.#fsWatchListeners.forEach(e => {
                      e.emit('modify-' + mod.url, { useDeno })
                    })
                  }
                }
                applyEffect(mod.url)
                this.applyCompilationSideEffect(url, (mod) => {
                  applyEffect(mod.url)
                  if (!hmrable && this.isHMRable(mod.url)) {
                    this.#fsWatchListeners.forEach(w => w.emit('modify-' + mod.url))
                  }
                })
              }).catch(err => {
                log.error(`compile(${url}):`, err.message)
              })
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
          }, 150)
        }
      }
    }
  }

  /** check the changed file whether it is a scoped module */
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

  get framework() {
    return this.config.framework
  }

  get srcDir() {
    return join(this.workingDir, this.config.srcDir)
  }

  get outputDir() {
    return join(this.workingDir, this.config.outputDir)
  }

  get buildDir() {
    return join(this.workingDir, '.aleph', this.mode)
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

  /** find the module by given name. */
  findModuleByName(name: string): Module | null {
    for (const ext of moduleExts) {
      const url = `/${util.trimPrefix(name, '/')}.${ext}`
      if (this.#modules.has(url)) {
        return this.#modules.get(url)!
      }
    }
    return null
  }

  /** lookup style deps of given modules. */
  lookupStyleModules(...urls: string[]): Module[] {
    const mods: Module[] = []
    urls.forEach(url => {
      this.lookupDeps(url, ({ url }) => {
        const mod = this.#modules.get(url)
        if (mod && mod.isStyle) {
          mods.push({ ...mod, deps: [...mod.deps] })
        }
      })
    })
    return mods
  }

  /** get page route by given location. */
  getPageRoute(location: { pathname: string, search?: string }): [RouterURL, RouteModule[]] {
    return this.#pageRouting.createRouter(location)
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

  /** add a new page module by given path and source code. */
  async addModule(url: string, options: { code?: string } = {}): Promise<void> {
    await this.compile(url, { sourceCode: options.code })
    if (url.startsWith('/pages/')) {
      this.#pageRouting.update(...this.createRouteUpdate(url))
    } else if (url.startsWith('/api/')) {
      this.#apiRouting.update(...this.createRouteUpdate(url))
    }
    return
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

  /** inject HMR code  */
  injectHMRCode({ url }: Module, content: string): string {
    const hmrModuleImportUrl = getRelativePath(
      dirname(toLocalUrl(url)),
      toLocalUrl(`${getAlephPkgUri()}/framework/core/hmr.js`)
    )
    const lines = [
      `import { createHotContext } from ${JSON.stringify(hmrModuleImportUrl)};`,
      `import.meta.hot = createHotContext(${JSON.stringify(url)});`,
      '',
      content,
      '',
      'import.meta.hot.accept();'
    ]

    let code = lines.join('\n')
    this.#injects.get('hmr')?.forEach(transform => {
      code = transform(url, code)
    })
    return code
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
        let useDeno: boolean | undefined = undefined
        if (this.config.ssr !== false) {
          this.lookupDeps(url, dep => {
            if (dep.url.startsWith('#useDeno-')) {
              useDeno = true
              return false
            }
          })
        }
        return { url, useDeno }
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
    const fullAlephPkgPath = `${basePath}/_aleph/-/${alephPkgPath}`

    if (this.isDev) {
      const preload: string[] = [
        `${fullAlephPkgPath}/framework/core/module.js`,
        `${fullAlephPkgPath}/framework/core/events.js`,
        `${fullAlephPkgPath}/framework/core/routing.js`,
        `${fullAlephPkgPath}/framework/core/hmr.js`,
        `${fullAlephPkgPath}/framework/${framework}/bootstrap.js`,
        `${fullAlephPkgPath}/shared/util.js`,
      ]

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
        { src: `${fullAlephPkgPath}/nomodule.js`, nomodule: true },
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

  /** read the module contents. */
  async readModule(url: string) {
    const { content, contentType } = await this.fetchModule(url)
    const source = await this.precompile(url, content, contentType)
    if (source === null) {
      throw new Error(`Unsupported module '${url}'`)
    }
    return source
  }

  /** parse the export names of the module. */
  async parseModuleExportNames(url: string): Promise<string[]> {
    const source = await this.readModule(url)
    const names = await parseExportNames(url, source.code, { sourceType: source.type })
    return (await Promise.all(names.map(async name => {
      if (name.startsWith('{') && name.startsWith('}')) {
        return await this.parseModuleExportNames(name.slice(1, -1))
      }
      return name
    }))).flat()
  }

  /** default compiler options */
  get sharedCompileOptions(): TransformOptions {
    return {
      importMap: this.importMap,
      alephPkgUri: getAlephPkgUri(),
      react: this.config.react,
      isDev: this.isDev,
      inlineStylePreprocess: async (key: string, type: string, tpl: string) => {
        if (type !== 'css') {
          for (const loader of this.loaders) {
            if (loader.test.test(`.${type}`) && loader.transform) {
              const { code, type } = await loader.transform({ url: key, content: (new TextEncoder).encode(tpl) })
              if (type === 'css') {
                tpl = code
              }
            }
          }
        }
        return (await this.#cssProcesser.transform(key, tpl)).code
      }
    }
  }

  /** build the application to a static site(SSG) */
  async build() {
    const start = performance.now()

    // wait for app ready
    await this.ready

    const outputDir = this.outputDir
    const distDir = join(outputDir, '_aleph')

    // clear previous build
    if (existsDirSync(outputDir)) {
      for await (const entry of Deno.readDir(outputDir)) {
        await Deno.remove(join(outputDir, entry.name), { recursive: entry.isDirectory })
      }
    }
    await ensureDir(distDir)

    // copy bundle dist
    await this.#bundler.copyDist()

    // ssg
    await this.ssg()

    // copy public assets
    const publicDir = join(this.workingDir, 'public')
    if (existsDirSync(publicDir)) {
      let n = 0
      for await (const { path: p } of walk(publicDir, { includeDirs: false, skip: [/(^|\/|\\)\./] })) {
        const rp = util.trimPrefix(p, publicDir)
        const fp = join(outputDir, rp)
        const fi = await Deno.lstat(p)
        await ensureDir(dirname(fp))
        await Deno.copyFile(p, fp)
        if (n === 0) {
          log.info(bold('- Public Assets'))
        }
        log.info('  ∆', rp.split('\\').join('/'), dim('•'), formatBytesWithColor(fi.size))
        n++
      }
    }

    log.info(`Done in ${Math.round(performance.now() - start)}ms`)
  }

  private createRouteUpdate(url: string): [string, string, { isIndex?: boolean, useDeno?: boolean }] {
    const isBuiltinModule = moduleExts.some(ext => url.endsWith('.' + ext))
    let routePath = isBuiltinModule ? toPagePath(url) : util.trimSuffix(url, '/pages')
    let useDeno: boolean | undefined = undefined
    let isIndex: boolean | undefined = undefined

    if (this.config.ssr !== false) {
      this.lookupDeps(url, dep => {
        if (dep.url.startsWith('#useDeno-')) {
          useDeno = true
          return false
        }
      })
    }

    if (!isBuiltinModule) {
      for (const loader of this.loaders) {
        if (loader.test.test(url) && loader.pagePathResolve) {
          const { path, isIndex: _isIndex } = loader.pagePathResolve(url)
          if (!util.isNEString(path)) {
            throw new Error(`bad pagePathResolve result of '${loader.name}' plugin`)
          }
          routePath = path
          if (!!_isIndex) {
            isIndex = true
          }
          break
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

    return [routePath, url, { isIndex, useDeno }]
  }

  /** fetch module content */
  private async fetchModule(url: string): Promise<{ content: Uint8Array, contentType: string | null }> {
    for (const loader of this.loaders) {
      if (loader.test.test(url) && loader.resolve !== undefined) {
        const v = loader.resolve(url)
        let content: Uint8Array
        if (v instanceof Promise) {
          content = await v
        } else {
          content = v
        }
        if (content instanceof Uint8Array) {
          return { content, contentType: null }
        }
      }
    }

    if (!util.isLikelyHttpURL(url)) {
      const filepath = join(this.srcDir, util.trimPrefix(url, 'file://'))
      if (existsFileSync(filepath)) {
        const content = await Deno.readFile(filepath)
        return { content, contentType: null }
      } else {
        return Promise.reject(new Error(`No such file`))
      }
    }

    // todo: add options to download the remote css
    if (url.endsWith('.css') || url.endsWith('.pcss')) {
      return { content: new Uint8Array(), contentType: 'text/css' }
    }

    if (url.startsWith('https://esm.sh/')) {
      const u = new URL(url)
      if (this.isDev && !u.searchParams.has('dev')) {
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

  private async precompile(
    url: string,
    sourceContent: Uint8Array,
    contentType: string | null
  ): Promise<{
    code: string
    type: SourceType
    isStyle: boolean
    map?: string
  } | null> {
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()

    let sourceType: SourceType | null = null
    let sourceMap: Uint8Array | null = null
    let isStyle = false

    if (contentType !== null) {
      switch (contentType.split(';')[0].trim()) {
        case 'application/javascript':
        case 'text/javascript':
          sourceType = SourceType.JS
          break
        case 'text/typescript':
          sourceType = SourceType.TS
          break
        case 'text/jsx':
          sourceType = SourceType.JSX
          break
        case 'text/tsx':
          sourceType = SourceType.TSX
        case 'text/css':
          sourceType = SourceType.CSS
          break
      }
    }

    for (const loader of this.loaders) {
      if (loader.test.test(url) && loader.transform) {
        const { code, type = 'js', map } = await loader.transform({ url, content: sourceContent, map: sourceMap ?? undefined })
        sourceContent = encoder.encode(code)
        if (map) {
          sourceMap = encoder.encode(map)
        }
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
      }
    }

    if (sourceType === null) {
      switch (extname(url).slice(1).toLowerCase()) {
        case 'mjs':
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
        case 'postcss':
        case 'pcss':
        case 'css':
          sourceType = SourceType.CSS
          break
        default:
          return null
      }
    }

    if (sourceType === SourceType.CSS) {
      const { code, map } = await this.#cssProcesser.transform(url, (new TextDecoder).decode(sourceContent))
      sourceContent = encoder.encode(code)
      sourceType = SourceType.JS
      isStyle = true
      if (map) {
        sourceMap = encoder.encode(map)
      }
    }

    return {
      code: decoder.decode(sourceContent),
      type: sourceType,
      isStyle,
      map: sourceMap ? decoder.decode(sourceMap) : undefined
    }
  }

  /**
   * compile a moudle by given url, then cache on the disk.
   * each moudle only be compiled once unless you set the
   * `forceCompile` option to true.
   */
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
    const localUrl = toLocalUrl(url)
    const saveDir = join(this.buildDir, dirname(localUrl))
    const name = trimModuleExt(basename(localUrl))
    const metaFile = join(saveDir, `${name}.meta.json`)
    const jsFile = join(saveDir, `${name}.js`)

    let mod: Module
    let defer = (err?: Error) => { }

    if (this.#modules.has(url)) {
      mod = this.#modules.get(url)!
      if (!forceCompile && !sourceCode) {
        await mod.ready
        return mod
      }
      mod.ready = new Promise((resolve, reject) => {
        defer = (err?: Error) => err ? reject(err) : resolve()
      })
    } else {
      mod = {
        url,
        deps: [],
        isStyle: false,
        sourceHash: '',
        hash: '',
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
      if (!once) {
        this.#modules.set(url, mod)
      }
      if (existsFileSync(metaFile)) {
        try {
          const { url: _url, deps, isStyle, sourceHash } = JSON.parse(await Deno.readTextFile(metaFile))
          if (_url === url && util.isNEString(sourceHash) && util.isArray(deps)) {
            mod.sourceHash = sourceHash
            mod.deps = deps
            mod.isStyle = !!isStyle
          } else {
            log.warn(`removing invalid metadata '${name}.meta.json'`)
            Deno.remove(metaFile)
          }
        } catch (e) { }
      }
    }

    let sourceContent = new Uint8Array()
    let contentType: null | string = null
    let jsContent = ''
    let jsSourceMap: null | string = null
    let shouldTransform = false
    let fsync = false

    if (sourceCode) {
      sourceContent = (new TextEncoder).encode(sourceCode)
      const sourceHash = computeHash(sourceContent)
      if (mod.sourceHash === '' || mod.sourceHash !== sourceHash) {
        mod.sourceHash = sourceHash
        shouldTransform = true
      }
    } else {
      let shouldFetch = true
      if (
        !this.#reloading &&
        (isRemote && !url.startsWith('http://localhost:')) &&
        reFullVersion.test(url) &&
        mod.sourceHash !== ''
      ) {
        if (existsFileSync(jsFile)) {
          shouldFetch = false
        }
      }
      if (shouldFetch) {
        try {
          const { content, contentType: ctype } = await this.fetchModule(url)
          const sourceHash = computeHash(content)
          sourceContent = content
          contentType = ctype
          if (mod.sourceHash === '' || mod.sourceHash !== sourceHash) {
            mod.sourceHash = sourceHash
            shouldTransform = true
          }
        } catch (err) {
          log.error(`Fetch module '${url}':`, err.message)
          defer(err)
          return mod
        }
      }
    }

    mod.hash = mod.sourceHash

    // compile source code
    if (shouldTransform) {
      const ms = new Measure()
      const source = await this.precompile(url, sourceContent, contentType)
      if (source === null) {
        log.error(`Unsupported module '${url}'`)
        defer(new Error('Unsupported module'))
        return mod
      }

      const { code, deps, starExports, map } = await transform(url, source.code, {
        ...this.sharedCompileOptions,
        sourceMap: this.isDev,
        swcOptions: {
          sourceType: source.type
        },
      })

      jsContent = code
      if (map) {
        jsSourceMap = map
      }

      // in production/bundle mode we need to replace the star export with names
      if (starExports && starExports.length > 0) {
        for (let index = 0; index < starExports.length; index++) {
          const exportUrl = starExports[index]
          const names = await this.parseModuleExportNames(exportUrl)
          jsContent = jsContent.replace(`export * from "[${exportUrl}]:`, `export {${names.filter(name => name !== 'default').join(',')}} from "`)
        }
      }

      mod.isStyle = source.isStyle
      mod.deps = deps.filter(({ specifier }) => specifier != mod.url)
        .map(({ specifier, isDynamic }) => {
          const dep: DependencyDescriptor = { url: specifier, hash: '' }
          if (isDynamic) {
            dep.isDynamic = true
          }
          if (dep.url.startsWith('#useDeno-') && !this.config.ssr) {
            log.warn(`use 'useDeno' hook in SPA mode: ${url}`)
          }
          return dep
        })

      fsync = true
      ms.stop(`compile '${url}'`)
    }

    // compile deps
    try {
      await Promise.all(mod.deps.map(async dep => {
        if (!dep.url.startsWith('#')) {
          const depMod = await this.compile(dep.url, { once })
          if (dep.hash === '' || dep.hash !== depMod.hash) {
            dep.hash = depMod.hash
            if (!util.isLikelyHttpURL(dep.url)) {
              if (jsContent === '') {
                jsContent = await Deno.readTextFile(jsFile)
              }
              jsContent = this.updateImportUrls(jsContent, dep)
              if (!fsync) {
                fsync = true
              }
            }
          }
        }
      }))
    } catch (err) {
      log.error(`Write module '${url}' to JS:`, err.message)
      defer(err)
      return mod
    }

    // update hash using deps status
    if (mod.deps.length > 0) {
      mod.hash = computeHash(mod.sourceHash + mod.deps.map(({ hash }) => hash).join(''))
    }

    if (fsync) {
      if (jsSourceMap) {
        jsContent += `//# sourceMappingURL=${basename(jsFile)}.map`
      }
      try {
        await Promise.all([
          ensureTextFile(metaFile, JSON.stringify({
            url,
            deps: mod.deps,
            sourceHash: mod.sourceHash,
            isStyle: mod.isStyle ? true : undefined
          }, undefined, 2)),
          ensureTextFile(jsFile, jsContent),
          jsSourceMap ? ensureTextFile(jsFile + '.map', jsSourceMap) : Promise.resolve(),
        ])
        await lazyRemove(util.trimSuffix(jsFile, '.js') + '.bundling.js')
      } catch (err) {
        log.error(`Write module '${url}' to JS:`, err.message)
        defer(err)
        return mod
      }
    }

    defer()
    return mod
  }

  /** apply compilation side-effect caused by dependency graph breaking. */
  private async applyCompilationSideEffect(url: string, callback: (mod: Module) => void) {
    const { hash } = this.#modules.get(url)!
    for (const mod of this.#modules.values()) {
      for (const dep of mod.deps) {
        if (dep.url === url) {
          const jsContent = this.updateImportUrls(
            await Deno.readTextFile(mod.jsFile),
            { url, hash }
          )
          await Deno.writeTextFile(mod.jsFile, jsContent)
          dep.hash = hash
          mod.hash = computeHash(mod.sourceHash + mod.deps.map(({ hash }) => hash).join(''))
          callback(mod)
          log.debug('compilation side-effect:', mod.url, dim('<-'), url)
          this.applyCompilationSideEffect(mod.url, callback)
        }
      }
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
      [`${getAlephPkgUri()}/framework/${this.framework}/bootstrap.ts`],
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
    const outputDir = this.outputDir

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
              `_aleph/data/${btoa(pathname)}.json`
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

  /** update the hash in import url of deps. */
  private updateImportUrls(jsContent: string, dep: DependencyDescriptor) {
    const s = `.js#${dep.url}@`
    return jsContent.split(s).map((p, i) => {
      if (i > 0 && p.charAt(6) === '"') {
        return dep.hash.slice(0, 6) + p.slice(6)
      }
      return p
    }).join(s)
  }

  /** lookup deps recurively. */
  private lookupDeps(
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
        return
      }
    }
  }
}
