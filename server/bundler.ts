import { minify, ECMA } from 'https://esm.sh/terser@5.5.1'
import { TransformOptions, transform } from '../compiler/mod.ts'
import { colors, path } from '../deps.ts'
import { defaultReactVersion, hashShortLength } from '../shared/constants.ts'
import { existsFileSync, lazyRemove } from '../shared/fs.ts'
import log from '../shared/log.ts'
import util from '../shared/util.ts'
import { VERSION } from '../version.ts'
import type { Application, Module } from './app.ts'
import { AlephRuntimeCode, clearCompilation, computeHash, getAlephPkgUri, isLoaderPlugin, trimModuleExt } from './helper.ts'

/** The bundler class for aleph server. */
export class Bundler {
  #app: Application
  #deps: Array<string>

  constructor(app: Application) {
    this.#app = app
    this.#deps = []
  }

  async bundle(entryMods: Array<string>, depMods: Map<string, boolean>) {
    this.#deps = Array.from(depMods.keys())
    await Promise.all([
      await this.createPolyfillBundle(),
      await this.createBundleChunk(
        '/deps.js',
        Array.from(depMods.entries())
          .filter(([url, exported]) => exported && util.isLikelyHttpURL(url))
          .map(([url]) => url)
      ),
      await this.createBundleChunk(
        '/shared.js',
        Array.from(depMods.entries())
          .filter(([url, exported]) => exported && !util.isLikelyHttpURL(url))
          .map(([url]) => url)
      ),
      ...entryMods.map(async url => {
        await this.createBundleChunk(trimModuleExt(url) + '.js', [url])
      })
    ])
  }

  private async compile(module: Module) {
    const { content: sourceCode } = await this.#app.fetchModule(module.url)
    const { code, map, deps } = await transform(module.url, (new TextDecoder).decode(sourceCode), {
      importMap: this.#app.importMap,
      alephPkgUri: getAlephPkgUri(),
      reactVersion: defaultReactVersion,
      swcOptions: {
        target: 'es2020',
        sourceType: 'js'
      },
      bundleMode: true,
      bundleExternal: this.#deps,
      loaders: this.#app.config.plugins.filter(isLoaderPlugin)
    })
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

  /** create polyfill bundle. */
  private async createPolyfillBundle() {
    const alephPkgUri = getAlephPkgUri()
    const { buildTarget } = this.#app.config
    const hash = computeHash(AlephRuntimeCode + buildTarget + Deno.version.deno + VERSION)
    const bundleFile = path.join(this.#app.buildDir, `polyfill.bundle.${hash.slice(0, hashShortLength)}.js`)
    if (!existsFileSync(bundleFile)) {
      const rawPolyfillFile = `${alephPkgUri}/compiler/polyfills/${buildTarget}/mod.ts`
      await this.runDenoBundle(rawPolyfillFile, bundleFile, AlephRuntimeCode, true)
    }
    log.info(`  {} polyfill (${buildTarget.toUpperCase()}) ${colors.dim('• ' + util.formatBytes(Deno.statSync(bundleFile).size))}`)
  }

  /** create bundle chunk. */
  private async createBundleChunk(name: string, entry: string[]) {
    const entryCode = entry.map((url, i) => {
      let mod = this.#app.getModule(url)
      if (mod) {
        const { jsFile } = mod
        return jsFile ? [
          `import * as ${name}_mod_${i} from ${JSON.stringify('file://' + jsFile)}`,
          `__ALEPH.pack[${JSON.stringify(url)}] = ${name}_mod_${i}`
        ] : []
      }
    }).flat().join('\n')
    const hash = computeHash(entryCode + VERSION + Deno.version.deno)
    const bundleEntryFile = path.join(this.#app.buildDir, `${name}.bundle.entry.js`)
    const bundleFile = path.join(this.#app.buildDir, `${name}.bundle.${hash.slice(0, hashShortLength)}.js`)
    if (!existsFileSync(bundleFile)) {
      await Deno.writeTextFile(bundleEntryFile, entryCode)
      await this.runDenoBundle(bundleEntryFile, bundleFile)
      lazyRemove(bundleEntryFile)
    }
    log.info(`  {} ${name} ${colors.dim('• ' + util.formatBytes(Deno.statSync(bundleFile).size))}`)
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
