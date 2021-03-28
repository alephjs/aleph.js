import { bold, dim } from 'https://deno.land/std@0.90.0/fmt/colors.ts'
import { walk } from 'https://deno.land/std@0.90.0/fs/walk.ts'
import { ensureDir } from 'https://deno.land/std@0.90.0/fs/ensure_dir.ts'
import { createHash } from 'https://deno.land/std@0.90.0/hash/mod.ts'
import {
  basename,
  dirname,
  extname,
  join,
  resolve
} from 'https://deno.land/std@0.90.0/path/mod.ts'
import { CSSProcessor } from '../compiler/css.ts'
import {
  buildChecksum,
  ImportMap,
  parseExportNames,
  SourceType,
  transform,
  TransformOptions
} from '../compiler/mod.ts'
import { EventEmitter } from '../framework/core/events.ts'
import { moduleExts, toPagePath, trimModuleExt } from '../framework/core/module.ts'
import { RouteModule, Routing } from '../framework/core/routing.ts'
import { defaultReactVersion, minDenoVersion } from '../shared/constants.ts'
import {
  ensureTextFile,
  existsDirSync,
  existsFileSync
} from '../shared/fs.ts'
import log from '../shared/log.ts'
import util from '../shared/util.ts'
import type {
  Config,
  RouterURL,
  ServerApplication,
} from '../types.ts'
import { VERSION } from '../version.ts'
import { Bundler, bundlerRuntimeCode } from './bundler.ts'
import { defaultConfig, loadConfig, loadImportMap, loadPostCSSConfig } from './config.ts'
import {
  computeHash,
  formatBytesWithColor,
  getAlephPkgUri,
  getDenoDir,
  getRelativePath,
  isLoaderPlugin,
  reFullVersion,
  toLocalUrl
} from './helper.ts'
import { Renderer } from './ssr.ts'

/** A module includes the compilation details. */
export type Module = {
  url: string
  jsFile: string
  sourceHash: string
  hash: string
  deps: DependencyDescriptor[]
}

/** The dependency descriptor. */
export type DependencyDescriptor = {
  url: string
  hash: string
  isDynamic?: boolean
}

type TransformFn = (url: string, code: string) => string

/** The application class for aleph server. */
export class Application implements ServerApplication {
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
    this.workingDir = resolve(workingDir)
    this.mode = mode
    this.config = { ...defaultConfig }
    this.importMap = { imports: {}, scopes: {} }
    this.ready = this.init(reload)
  }

  /** initiate application */
  private async init(reload: boolean) {
    let t = performance.now()
    const [config, importMap, postcssConfig] = await Promise.all([
      loadConfig(this.workingDir),
      loadImportMap(this.workingDir),
      loadPostCSSConfig(this.workingDir),
    ])

    Object.assign(this.config, config)
    Object.assign(this.importMap, importMap)
    this.#pageRouting.config(this.config)
    this.#cssProcesser.config(!this.isDev, postcssConfig.plugins)

    // inject env variables
    Deno.env.set('ALEPH_VERSION', VERSION)
    Deno.env.set('BUILD_MODE', this.mode)

    // inject browser navigator polyfill
    Object.assign((globalThis as any).navigator, {
      connection: {
        downlink: 10,
        effectiveType: "4g",
        onchange: null,
        rtt: 50,
        saveData: false,
      },
      cookieEnabled: false,
      language: 'en',
      languages: ['en'],
      onLine: true,
      platform: Deno.build.os,
      userAgent: `Deno/${Deno.version.deno}`,
      vendor: 'Deno Land'
    })

    log.debug(`load config in ${Math.round(performance.now() - t)}ms`)
    t = performance.now()

    const alephPkgUri = getAlephPkgUri()
    const buildManifestFile = join(this.buildDir, 'build.manifest.json')
    const configChecksum = computeHash(JSON.stringify({
      ...this.defaultCompileOptions,
      plugins: this.config.plugins.filter(isLoaderPlugin).map(({ name }) => name)
    }))
    let shouldRebuild = !existsFileSync(buildManifestFile)
    if (!shouldRebuild) {
      try {
        const v = JSON.parse(await Deno.readTextFile(buildManifestFile))
        shouldRebuild = (
          typeof v !== 'object' ||
          v === null ||
          v.compiler !== buildChecksum ||
          v.configChecksum !== configChecksum
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
        configChecksum,
      }, undefined, 2))
    }

    // apply server plugins
    for (const plugin of this.config.plugins) {
      if (plugin.type === 'server') {
        await plugin.onInit(this)
      }
    }

    // init framework
    const { init } = await import(`../framework/${this.config.framework}/init.ts`)
    await init(this)

    // import framework renderer
    if (this.config.ssr) {
      const { jsFile } = await this.compile(`${alephPkgUri}/framework/${this.config.framework}/renderer.ts`)
      const { render } = await import(`file://${jsFile}`)
      if (util.isFunction(render)) {
        this.#renderer.setFrameworkRenderer({ render })
      }
    }

    log.info('Compiling...')

    // pre-compile framework modules
    await this.compile(`${alephPkgUri}/framework/${this.config.framework}/bootstrap.ts`)
    if (this.isDev) {
      await this.compile(`${alephPkgUri}/framework/core/hmr.ts`)
      await this.compile(`${alephPkgUri}/framework/core/nomodule.ts`)
    }

    // compile custom components
    for (const name of ['app', '404', 'loading']) {
      for (const ext of moduleExts) {
        if (existsFileSync(join(this.srcDir, `${name}.${ext}`))) {
          await this.compile(`/${name}.${ext}`)
          break
        }
      }
    }

    const walkOptions = {
      includeDirs: false,
      skip: [
        /(^|\/|\\)\./,
        /\.d\.ts$/i,
        /(\.|_)(test|spec|e2e)\.(tsx?|jsx?|mjs)?$/i
      ]
    }

    // load page routing
    const pagesDir = join(this.srcDir, 'pages')
    if (existsDirSync(pagesDir)) {
      for await (const { path: p } of walk(pagesDir, walkOptions)) {
        const url = util.cleanPath('/pages/' + util.trimPrefix(p, pagesDir))
        let validated = moduleExts.some(ext => p.endsWith('.' + ext))
        if (!validated) {
          validated = this.config.plugins.some(p => p.type === 'loader' && p.test.test(url) && p.allowPage)
        }
        if (validated) {
          await this.compile(url)
          if (this.#modules.has(url)) {
            this.#pageRouting.update(...this.createRouteUpdate(url))
          }
        }
      }
    }

    // load api routing
    const apiDir = join(this.srcDir, 'api')
    if (existsDirSync(apiDir)) {
      for await (const { path: p } of walk(apiDir, { ...walkOptions, exts: moduleExts })) {
        const url = util.cleanPath('/api/' + util.trimPrefix(p, apiDir))
        await this.compile(url)
        if (this.#modules.has(url)) {
          this.#apiRouting.update(...this.createRouteUpdate(url))
        }
      }
    }

    // pre-bundle
    if (!this.isDev) {
      await this.bundle()
    }

    // end reload
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
                    const [pagePath] = this.createRouteUpdate(url)
                    this.#renderer.clearCache(pagePath)
                    this.#pageRouting.update(...this.createRouteUpdate(url))
                  } else if (url.startsWith('/api/')) {
                    this.#apiRouting.update(...this.createRouteUpdate(url))
                  }
                }
                if (hmrable) {
                  let pagePath: string | undefined = undefined
                  let useDeno: boolean | undefined = undefined
                  let isIndex: boolean | undefined = undefined
                  if (mod.url.startsWith('/pages/')) {
                    const [path, _, options] = this.createRouteUpdate(mod.url)
                    pagePath = path
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
                      e.emit('add', { url: mod.url, pagePath, isIndex, useDeno })
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
                const [pagePath] = this.createRouteUpdate(url)
                this.#renderer.clearCache(pagePath)
                this.#pageRouting.removeRoute(pagePath)
              } else if (url.startsWith('/api/')) {
                const [pagePath] = this.createRouteUpdate(url)
                this.#apiRouting.removeRoute(pagePath)
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
    if (this.config.plugins.some(p => p.type === 'loader' && p.test.test(url) && p.allowPage)) {
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

  get srcDir() {
    return this.getDir('src', () => join(this.workingDir, this.config.srcDir))
  }

  get outputDir() {
    return this.getDir('output', () => join(this.workingDir, this.config.outputDir))
  }

  get buildDir() {
    return this.getDir('build', () => join(this.workingDir, '.aleph', this.mode))
  }

  /** returns the module by given url. */
  getModule(url: string): Module | null {
    if (this.#modules.has(url)) {
      return this.#modules.get(url)!
    }
    return null
  }

  findModuleByName(name: string): Module | null {
    for (const ext of moduleExts) {
      const url = `/${util.trimPrefix(name, '/')}.${ext}`
      if (this.#modules.has(url)) {
        return this.#modules.get(url)!
      }
    }
    return null
  }

  getPageRoute(location: { pathname: string, search?: string }): [RouterURL, RouteModule[]] {
    return this.#pageRouting.createRouter(location)
  }

  getAPIRoute(location: { pathname: string, search?: string }): [RouterURL, Module] | null {
    const router = this.#apiRouting.createRouter(location)
    if (router !== null) {
      const [url, nestedModules] = router
      if (url.pagePath !== '') {
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
    const { pagePath } = router
    if (pagePath === '') {
      return null
    }

    const path = loc.pathname + (loc.search || '')
    const [_, data] = await this.#renderer.useCache(pagePath, path, async () => {
      return await this.#renderer.renderPage(router, nestedModules)
    })
    return data
  }

  /** get ssr page */
  async getPageHTML(loc: { pathname: string, search?: string }): Promise<[number, string]> {
    const [router, nestedModules] = this.#pageRouting.createRouter(loc)
    const { pagePath } = router
    const status = pagePath !== '' ? 200 : 404
    const path = loc.pathname + (loc.search || '')

    if (!this.isSSRable(loc.pathname)) {
      const [html] = await this.#renderer.useCache('-', 'spa-index', async () => {
        return [await this.#renderer.renderSPAIndexPage(), null]
      })
      return [status, html]
    }

    if (pagePath === '') {
      const [html] = await this.#renderer.useCache('404', path, async () => {
        return [await this.#renderer.render404Page(router), null]
      })
      return [status, html]
    }

    const [html] = await this.#renderer.useCache(pagePath, path, async () => {
      let [html, data] = await this.#renderer.renderPage(router, nestedModules)
      return [html, data]
    })
    return [status, html]
  }

  getCodeInjects(phase: 'compilation' | 'hmr' | 'ssr') {
    return this.#injects.get(phase)
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

    return this.config.plugins.some(p => (
      p.type === 'loader' &&
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
    const { baseUrl: baseURL, defaultLocale, framework } = this.config
    const config: Record<string, any> = {
      baseURL,
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
        `__ALEPH.baseURL = ${JSON.stringify(baseURL)};`,
        `__ALEPH.pack["${alephPkgUri}/framework/${framework}/bootstrap.ts"].default(${JSON.stringify(config)});`
      ].join('')
    }

    let code = [
      `import bootstrap from "./-/${alephPkgPath}/framework/${framework}/bootstrap.js";`,
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
    const baseUrl = util.trimSuffix(this.config.baseUrl, '/')
    const alephPkgPath = getAlephPkgUri().replace('https://', '').replace('http://localhost:', 'http_localhost_')
    const fullAlephPkgPath = `${baseUrl}/_aleph/-/${alephPkgPath}`

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
            preload.push(`${baseUrl}/_aleph/app.js`)
            break
          case '/404':
            preload.push(`${baseUrl}/_aleph/404.js`)
            break
        }
      })

      if (entryFile) {
        preload.push(`${baseUrl}/_aleph${entryFile}`)
      }

      return [
        ...preload.map(src => ({ src, type: 'module', preload: true })),
        { src: `${baseUrl}/_aleph/main.js`, type: 'module' },
        { src: `${fullAlephPkgPath}/nomodule.js`, nomodule: true },
      ]
    }

    return [
      bundlerRuntimeCode,
      ...['polyfill', 'deps', 'shared', 'main', entryFile ? util.trimSuffix(entryFile, '.js') : '']
        .filter(name => name !== "" && this.#bundler.getBundledFile(name) !== null)
        .map(name => ({
          src: `${baseUrl}/_aleph/${this.#bundler.getBundledFile(name)}`
        }))
    ]
  }

  async resolveModule(url: string) {
    const { content, contentType } = await this.fetchModule(url)
    const source = await this.precompile(url, content, contentType)
    if (source === null) {
      throw new Error(`Unsupported module '${url}'`)
    }
    return source
  }

  /** default compiler options */
  private get defaultCompileOptions(): TransformOptions {
    return {
      importMap: this.importMap,
      alephPkgUri: getAlephPkgUri(),
      reactVersion: defaultReactVersion,
      isDev: this.isDev,
    }
  }

  /** build the application to a static site(SSG) */
  async build() {
    const start = performance.now()
    const outputDir = this.outputDir
    const distDir = join(outputDir, '_aleph')

    // wait for app ready
    await this.ready

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

  private getDir(name: string, init: () => string) {
    if (this.#dirs.has(name)) {
      return this.#dirs.get(name)!
    }

    const dir = init()
    this.#dirs.set(name, dir)
    return dir
  }

  private createRouteUpdate(url: string): [string, string, { isIndex?: boolean, useDeno?: boolean }] {
    const isBuiltinModule = moduleExts.some(ext => url.endsWith('.' + ext))
    let pagePath = isBuiltinModule ? toPagePath(url) : util.trimSuffix(url, '/pages')
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
      for (const plugin of this.config.plugins) {
        if (plugin.type === 'loader' && plugin.test.test(url) && plugin.pagePathResolve) {
          const { path, isIndex: _isIndex } = plugin.pagePathResolve(url)
          if (!util.isNEString(path)) {
            throw new Error(`bad pagePathResolve result of '${plugin.name}' plugin`)
          }
          pagePath = path
          if (!!_isIndex) {
            isIndex = true
          }
          break
        }
      }
    } else if (pagePath !== '/') {
      for (const ext of moduleExts) {
        if (url.endsWith('/index.' + ext)) {
          isIndex = true
          break
        }
      }
    }

    return [pagePath, url, { isIndex, useDeno }]
  }

  /** fetch module content */
  private async fetchModule(url: string): Promise<{ content: Uint8Array, contentType: string | null }> {
    for (const plugin of this.config.plugins) {
      if (plugin.type === 'loader' && plugin.test.test(url) && plugin.resolve !== undefined) {
        const v = plugin.resolve(url)
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

    const u = new URL(url)
    if (url.startsWith('https://esm.sh/')) {
      if (this.isDev && !u.searchParams.has('dev')) {
        u.searchParams.set('dev', '')
        u.search = u.search.replace('dev=', 'dev')
      }
    }

    const { protocol, hostname, port, pathname, search } = u
    const isLocalhost = hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '172.0.0.1'
    const versioned = reFullVersion.test(pathname)
    const reload = this.#reloading || !versioned
    const cacheDir = join(
      await getDenoDir(),
      'deps',
      util.trimSuffix(protocol, ':'),
      hostname + (port ? '_PORT' + port : '')
    )
    const hash = createHash('sha256').update(pathname + search).toString()
    const contentFile = join(cacheDir, hash)
    const metaFile = join(cacheDir, hash + '.metadata.json')

    if (!reload && !isLocalhost && existsFileSync(contentFile) && existsFileSync(metaFile)) {
      const [content, meta] = await Promise.all([
        Deno.readFile(contentFile),
        Deno.readTextFile(metaFile),
      ])
      try {
        const { headers } = JSON.parse(meta)
        return {
          content,
          contentType: headers['content-type'] || null
        }
      } catch (e) { }
    }

    // download dep when deno cache failed
    let err = new Error('Unknown')
    for (let i = 0; i < 10; i++) {
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
          }, undefined, 2))
        }
        return {
          content,
          contentType: resp.headers.get('content-type')
        }
      } catch (e) {
        err = e
      }
    }

    return Promise.reject(err)
  }

  private async precompile(
    url: string,
    sourceContent: Uint8Array,
    contentType: string | null
  ): Promise<{ code: string, type: SourceType, map: string | null } | null> {
    let sourceCode = (new TextDecoder).decode(sourceContent)
    let sourceType: SourceType | null = null
    let sourceMap: string | null = null

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

    for (const plugin of this.config.plugins) {
      if (plugin.type === 'loader' && plugin.test.test(url) && plugin.transform) {
        const { code, type = 'js', map } = await plugin.transform({ url, content: sourceContent })
        sourceCode = code
        if (map) {
          sourceMap = map
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
        break
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
        case 'pcss':
        case 'css':
          sourceType = SourceType.CSS
          break
        default:
          return null
      }
    }

    if (sourceType === SourceType.CSS) {
      const { code, map } = await this.#cssProcesser.transform(url, sourceCode)
      sourceCode = code
      sourceType = SourceType.JS
      if (map) {
        sourceMap = map
      }
    }

    return { code: sourceCode, type: sourceType, map: sourceMap }
  }

  /** compile a moudle by given url, then cache on the disk. */
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
    const isRemote = util.isLikelyHttpURL(url)
    const localUrl = toLocalUrl(url)
    const name = trimModuleExt(basename(localUrl))
    const saveDir = join(this.buildDir, dirname(localUrl))
    const metaFile = join(saveDir, `${name}.meta.json`)
    const { sourceCode, forceCompile, once } = options

    let mod: Module
    if (this.#modules.has(url)) {
      mod = this.#modules.get(url)!
      if (!forceCompile && !sourceCode) {
        return mod
      }
    } else {
      mod = {
        url,
        deps: [],
        sourceHash: '',
        hash: '',
        jsFile: util.cleanPath(`${saveDir}/${name}.js`),
      }
      if (!once) {
        this.#modules.set(url, mod)
      }
      if (existsFileSync(metaFile)) {
        try {
          const { url: __url, sourceHash, deps } = JSON.parse(await Deno.readTextFile(metaFile))
          if (__url === url && util.isNEString(sourceHash) && util.isArray(deps)) {
            mod.sourceHash = sourceHash
            mod.deps = deps
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
    let shouldCompile = false
    let fsync = false

    if (sourceCode) {
      sourceContent = (new TextEncoder).encode(sourceCode)
      const sourceHash = computeHash(sourceContent)
      if (mod.sourceHash === '' || mod.sourceHash !== sourceHash) {
        mod.sourceHash = sourceHash
        shouldCompile = true
      }
    } else {
      let shouldFetch = true
      if (
        !this.#reloading &&
        (isRemote && !url.startsWith('http://localhost:')) &&
        reFullVersion.test(url) &&
        mod.sourceHash !== ''
      ) {
        const jsFile = join(saveDir, name + '.js')
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
            shouldCompile = true
          }
        } catch (err) {
          log.error(`Fetch module '${url}':`, err.message)
          this.#modules.delete(url)
          return mod
        }
      }
    }

    mod.hash = mod.sourceHash

    // compile source code
    if (shouldCompile) {
      const t = performance.now()
      const source = await this.precompile(url, sourceContent, contentType)
      if (source === null) {
        log.error(`Unsupported module '${url}'`)
        this.#modules.delete(url)
        return mod
      }

      const { code, deps, starExports, map } = await transform(url, source.code, {
        ...this.defaultCompileOptions,
        swcOptions: {
          target: 'es2020',
          sourceType: source.type
        },
        // workaround for https://github.com/denoland/deno/issues/9849
        resolveStarExports: !this.isDev && Deno.version.deno.replace(/\.\d+$/, '') === '1.8',
        sourceMap: this.isDev,
        loaders: this.config.plugins.filter(isLoaderPlugin)
      })

      jsContent = code
      if (map) {
        jsSourceMap = map
      }

      // workaround for https://github.com/denoland/deno/issues/9849
      if (starExports && starExports.length > 0) {
        for (let index = 0; index < starExports.length; index++) {
          const url = starExports[index]
          const source = await this.resolveModule(url)
          const names = await parseExportNames(url, source.code, { sourceType: source.type })
          jsContent = jsContent.replace(`export * from "${url}:`, `export {${names.filter(name => name !== 'default').join(',')}} from "`)
        }
      }

      mod.deps = deps.map(({ specifier, isDynamic }) => {
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
      log.debug(`compile '${url}' in ${Math.round(performance.now() - t)}ms`)
    }

    // compile deps
    for (const dep of mod.deps) {
      if (!dep.url.startsWith('#')) {
        const depMod = await this.compile(dep.url, { once })
        if (dep.hash === '' || dep.hash !== depMod.hash) {
          dep.hash = depMod.hash
          if (!util.isLikelyHttpURL(dep.url)) {
            if (jsContent === '') {
              jsContent = await Deno.readTextFile(mod.jsFile)
            }
            jsContent = this.replaceDepHash(jsContent, dep)
            if (!fsync) {
              fsync = true
            }
          }
        }
      }
    }

    // update hash by deps
    if (mod.deps.length > 0) {
      mod.hash = computeHash(mod.sourceHash + mod.deps.map(({ hash }) => hash).join(''))
    }

    if (fsync) {
      await Promise.all([
        ensureTextFile(metaFile, JSON.stringify({
          url,
          sourceHash: mod.sourceHash,
          deps: mod.deps,
        }, undefined, 2)),
        ensureTextFile(mod.jsFile, jsContent + (jsSourceMap ? `//# sourceMappingURL=${basename(mod.jsFile)}.map` : '')),
        jsSourceMap ? ensureTextFile(mod.jsFile + '.map', jsSourceMap) : Promise.resolve(),
      ])
    }

    return mod
  }

  /** apply compilation side-effect caused by dependency graph breaking. */
  private async applyCompilationSideEffect(url: string, callback: (mod: Module) => void) {
    const { hash } = this.#modules.get(url)!

    for (const mod of this.#modules.values()) {
      for (const dep of mod.deps) {
        if (dep.url === url) {
          const jsContent = this.replaceDepHash(
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

    log.info('- bundle')
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
    if (typeof ssr === 'object' && ssr.staticPaths) {
      ssr.staticPaths.forEach(path => paths.add(path))
    }
    await Promise.all(Array.from(paths).map(async pathname => {
      if (this.isSSRable(pathname)) {
        const [router, nestedModules] = this.#pageRouting.createRouter({ pathname })
        if (router.pagePath !== '') {
          let [html, data] = await this.#renderer.renderPage(router, nestedModules)
          this.#injects.get('ssr')?.forEach(transform => {
            html = transform(pathname, html)
          })
          await ensureTextFile(join(outputDir, pathname, 'index.html'), html)
          if (data) {
            const dataFile = join(
              outputDir,
              '_aleph/data',
              (pathname === '/' ? 'index' : pathname) + '.json'
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

  private replaceDepHash(jsContent: string, dep: DependencyDescriptor) {
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
