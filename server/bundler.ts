import { minify, ECMA } from 'https://esm.sh/terser@5.5.1'
import { TransformOptions, transform } from '../compiler/mod.ts'
import { colors, path } from '../deps.ts'
import { defaultReactVersion } from '../shared/constants.ts'
import { ensureTextFile, existsFileSync, lazyRemove } from '../shared/fs.ts'
import log from '../shared/log.ts'
import util from '../shared/util.ts'
import { Module } from '../types.ts'
import { VERSION } from '../version.ts'
import type { Application } from './app.ts'
import {
  clearCompilation,
  computeHash,
  getAlephPkgUri,
  isLoaderPlugin,
  trimModuleExt
} from './helper.ts'

const bundlerRuntimeCode = `
var __ALEPH = window.__ALEPH || (window.__ALEPH = {
  pack: {},
  require: function(name) {
    switch (name) {
    case 'regenerator-runtime':
      return regeneratorRuntime
    default:
      throw new Error('module "' + name + '" is undefined')
    }
  },
});
`

/** The bundler class for aleph server. */
export class Bundler {
  #app: Application

  constructor(app: Application) {
    this.#app = app
  }

  async bundle(entryMods: Array<{ url: string, shared: boolean }>) {
    const remoteEntries: Array<string> = []
    const sharedEntries: Array<string> = []
    const entries: Array<string> = []

    entryMods.forEach(({ url, shared }) => {
      if (shared) {
        if (util.isLikelyHttpURL(url)) {
          remoteEntries.push(url)
        } else {
          sharedEntries.push(url)
        }
      } else {
        entries.push(url)
      }
    })

    await Promise.all([
      // this.createPolyfillBundle(),
      this.createBundleChunk(
        'deps',
        remoteEntries,
        []
      ),
      this.createBundleChunk(
        'shared',
        sharedEntries,
        remoteEntries
      ),
      ...entries.map(url => {
        this.createBundleChunk(
          trimModuleExt(url),
          [url],
          [remoteEntries, sharedEntries].flat()
        )
      })
    ])
  }

  private async compile(mod: Module, external: string[]) {
    const bundlingFile = util.trimSuffix(mod.jsFile, '.js') + '.bundling.js'
    if (existsFileSync(bundlingFile)) {
      return bundlingFile
    }

    const { content, contentType } = await this.#app.fetchModule(mod.url)
    const source = await this.#app.precompile(mod.url, content, contentType)
    if (source === null) {
      throw new Error(`Unsupported module '${mod.url}'`)
    }

    const [sourceCode, sourceType] = source
    const { code } = await transform(
      mod.url,
      sourceCode,
      {
        importMap: this.#app.importMap,
        alephPkgUri: getAlephPkgUri(),
        reactVersion: defaultReactVersion,
        swcOptions: {
          target: 'es2020',
          sourceType
        },
        bundleMode: true,
        bundleExternal: external,
        loaders: this.#app.config.plugins.filter(isLoaderPlugin)
      }
    )

    await ensureTextFile(bundlingFile, code)

    return bundlingFile
  }

  async copyDist() {
    // const pageModules: Module[] = []
    // this.#pageRouting.lookup(routes => routes.forEach(({ module: { url } }) => {
    //   const mod = this.getModule(url)
    //   if (mod) {
    //     pageModules.push(mod)
    //   }
    // }))
    // await Promise.all([
    //   (async () => {
    //     const mainJS = this.getMainJS(true)
    //     const filename = `main.bundle.${util.shortHash(computeHash(mainJS))}.js`
    //     const saveAs = path.join(this.outputDir, '_aleph', filename)
    //     await Deno.writeTextFile(saveAs, mainJS)
    //   })(),
    //   ...['deps', 'shared', 'polyfill'].map(async name => {
    //     const mod = this.#modules.get(`/${name}.js`)
    //     if (mod) {
    //       const { hash } = mod
    //       const bundleFile = path.join(this.buildDir, `${name}.bundle.${util.shortHash(hash)}.js`)
    //       const saveAs = path.join(this.outputDir, '_aleph', `${name}.bundle.${util.shortHash(hash)}.js`)
    //       await Deno.copyFile(bundleFile, saveAs)
    //     }
    //   }),
    //   ...pageModules.map(async mod => {
    //     const { jsFile, hash } = mod
    //     const pathname = util.trimSuffix(jsFile.replace(reHashJS, ''), '.bundling')
    //     const bundleFile = pathname + `.bundle.${util.shortHash(hash)}.js`
    //     const saveAs = path.join(this.outputDir, `/_aleph/`, util.trimPrefix(pathname, this.buildDir) + `.bundle.${util.shortHash(hash)}.js`)
    //     await ensureDir(path.dirname(saveAs))
    //     await Deno.copyFile(bundleFile, saveAs)
    //   })
    // ])
  }

  /** create bundle chunk. */
  private async createBundleChunk(name: string, entry: string[], deps: string[]) {
    const entryCode = (await Promise.all(entry.map(async (url, i) => {
      let mod = this.#app.getModule(url)
      if (mod && mod.jsFile !== '') {
        if (deps.length === 0) {
          return [
            `import * as mod_${i} from ${JSON.stringify('file://' + mod.jsFile)}`,
            `__ALEPH.pack[${JSON.stringify(url)}] = mod_${i}`
          ]
        } else {
          const jsFile = await this.compile(mod, deps)
          return [
            `import * as mod_${i} from ${JSON.stringify('file://' + jsFile)}`,
            `__ALEPH.pack[${JSON.stringify(url)}] = mod_${i}`
          ]
        }
      }
      return []
    }))).flat().join('\n')
    const hash = computeHash(entryCode + VERSION + Deno.version.deno)
    const bundleEntryFile = path.join(this.#app.buildDir, `${name}.bundle.entry.js`)
    const bundleFile = path.join(this.#app.buildDir, `${name}.bundle.${hash.slice(0, 8)}.js`)
    if (!existsFileSync(bundleFile)) {
      await Deno.writeTextFile(bundleEntryFile, entryCode)
      await this.runDenoBundle(bundleEntryFile, bundleFile)
      lazyRemove(bundleEntryFile)
    }
    log.info(`  {} ${name} ${colors.dim('• ' + util.formatBytes(Deno.statSync(bundleFile).size))}`)
  }

  /** create polyfill bundle. */
  private async createPolyfillBundle() {
    const alephPkgUri = getAlephPkgUri()
    const { buildTarget } = this.#app.config
    const hash = computeHash(bundlerRuntimeCode + buildTarget + Deno.version.deno + VERSION)
    const bundleFile = path.join(this.#app.buildDir, `polyfill.bundle.${hash.slice(0, 8)}.js`)
    if (!existsFileSync(bundleFile)) {
      const rawPolyfillFile = `${alephPkgUri}/compiler/polyfills/${buildTarget}/mod.ts`
      await this.runDenoBundle(rawPolyfillFile, bundleFile, bundlerRuntimeCode, false)
    }
    log.info(`  {} polyfill (${buildTarget.toUpperCase()}) ${colors.dim('• ' + util.formatBytes(Deno.statSync(bundleFile).size))}`)
  }

  /** run deno bundle and compress the output using terser. */
  private async runDenoBundle(bundleEntryFile: string, bundleFile: string, header = '', reload = false) {
    // todo: use Deno.emit()
    const p = Deno.run({
      cmd: [Deno.execPath(), 'bundle', '--no-check', reload ? '--reload' : '', bundleEntryFile, bundleFile].filter(Boolean),
      stdout: 'null',
      stderr: 'piped'
    })
    const data = await p.stderrOutput()
    p.close()
    if (!existsFileSync(bundleFile)) {
      const msg = (new TextDecoder).decode(data).replaceAll('file://', '').replaceAll(this.#app.buildDir, '/aleph.js')
      await Deno.stderr.write((new TextEncoder).encode(msg))
      Deno.exit(1)
    }

    // transpile bundle code to `buildTarget`
    const { buildTarget } = this.#app.config

    let { code } = await transform(
      '/bundle.js',
      await Deno.readTextFile(bundleFile),
      {
        transpileOnly: true,
        swcOptions: {
          target: buildTarget
        }
      }
    )

    // IIFEify
    code = `(() => { ${header};${code} })()`

    // minify code
    // todo: use swc minify instead(https://github.com/swc-project/swc/pull/1302)
    const ret = await minify(code, {
      compress: true,
      mangle: true,
      ecma: parseInt(util.trimPrefix(buildTarget, 'es')) as ECMA,
      sourceMap: false
    })
    if (ret.code) {
      code = ret.code
    }

    await clearCompilation(bundleFile)
    await Deno.writeTextFile(bundleFile, code)
  }
}
