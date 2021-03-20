import { minify as terser, ECMA } from 'https://esm.sh/terser@5.5.1'
import { transform } from '../compiler/mod.ts'
import { colors, ensureDir, path } from '../deps.ts'
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

export const bundlerRuntimeCode = `
  window.__ALEPH = {
    baseURL: '/',
    pack: {},
    import: function(src, specifier) {
      var pack = this.pack
      return new Promise(function(resolve, reject) {
        var script = document.createElement('script'),
            a = src.split('#'),
            src = a[0],
            b = a[1].split('@'),
            url = b[0],
            hash = b[1];
        script.onload = function () {
          resolve(pack[url])
        }
        script.onerror = function(err) {
          reject(err)
        }
        script.src = src + '?v=' + hash
        document.body.appendChild(script)
      })
    }
  }
`

/** The bundler class for aleph server. */
export class Bundler {
  #app: Application
  #compiledModules: Set<string>
  #bundledFiles: Map<string, string>

  constructor(app: Application) {
    this.#app = app
    this.#compiledModules = new Set()
    this.#bundledFiles = new Map()
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

    await this.createPolyfillBundle()
    await this.createBundleChunk(
      'deps',
      remoteEntries,
      []
    )
    if (sharedEntries.length > 0) {
      await this.createBundleChunk(
        'shared',
        sharedEntries,
        remoteEntries
      )
    }
    for (const url of entries) {
      await this.createBundleChunk(
        trimModuleExt(url),
        [url],
        [remoteEntries, sharedEntries].flat()
      )
    }
  }

  getBundledFile(name: string): string | null {
    return this.#bundledFiles.get(name) || null
  }

  async copyDist() {
    await Promise.all([
      ...Array.from(this.#bundledFiles.values()).map(jsFile => this.copyBundleFile(jsFile)),
      this.copyMainJS(),
    ])
  }

  private async copyMainJS() {
    const mainJS = this.#app.getMainJS(true)
    const hash = computeHash(mainJS)
    const jsFilename = `main.bundle.${hash.slice(0, 8)}.js`
    const saveAs = path.join(this.#app.outputDir, '_aleph', jsFilename)
    this.#bundledFiles.set('main', jsFilename)
    await ensureTextFile(saveAs, mainJS)
  }

  private async copyBundleFile(jsFilename: string) {
    const { buildDir, outputDir } = this.#app
    const bundleFile = path.join(buildDir, jsFilename)
    const saveAs = path.join(outputDir, '_aleph', jsFilename)
    await ensureDir(path.dirname(saveAs))
    await Deno.copyFile(bundleFile, saveAs)
  }

  private async compile(mod: Module, external: string[]): Promise<string> {
    const bundlingFile = util.trimSuffix(mod.jsFile, '.js') + '.bundling.js'

    if (this.#compiledModules.has(mod.url)) {
      return bundlingFile
    }

    const { content, contentType } = await this.#app.fetchModule(mod.url)
    const source = await this.#app.precompile(mod.url, content, contentType)
    if (source === null) {
      throw new Error(`Unsupported module '${mod.url}'`)
    }

    const [sourceCode, sourceType] = source
    let { code } = await transform(
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

    // compile deps
    for (const dep of mod.deps) {
      if (!dep.url.startsWith('#') && !external.includes(dep.url)) {
        const depMod = this.#app.getModule(dep.url)
        if (depMod !== null) {
          const s = `.bundling.js#${dep.url}@`
          await this.compile(depMod, external)
          code = code.split(s).map((p, i) => {
            if (i > 0 && p.charAt(6) === '"') {
              return dep.hash.slice(0, 6) + p.slice(6)
            }
            return p
          }).join(s)
        }
      }
    }

    await ensureTextFile(bundlingFile, code)
    this.#compiledModules.add(mod.url)

    return bundlingFile
  }

  /** create bundle chunk. */
  private async createBundleChunk(name: string, entry: string[], external: string[]) {
    const entryCode = (await Promise.all(entry.map(async (url, i) => {
      let mod = this.#app.getModule(url)
      if (mod && mod.jsFile !== '') {
        if (external.length === 0) {
          return [
            `import * as mod_${i} from ${JSON.stringify('file://' + mod.jsFile)}`,
            `__ALEPH.pack[${JSON.stringify(url)}] = mod_${i}`
          ]
        } else {
          const jsFile = await this.compile(mod, external)
          return [
            `import * as mod_${i} from ${JSON.stringify('file://' + jsFile)}`,
            `__ALEPH.pack[${JSON.stringify(url)}] = mod_${i}`
          ]
        }
      }
      return []
    }))).flat().join('\n')
    const hash = computeHash(entryCode + VERSION + Deno.version.deno)
    const bundleFilename = `${name}.bundle.${hash.slice(0, 8)}.js`
    const bundleEntryFile = path.join(this.#app.buildDir, `${name}.bundle.entry.js`)
    const bundleFile = path.join(this.#app.buildDir, bundleFilename)
    if (!existsFileSync(bundleFile)) {
      await Deno.writeTextFile(bundleEntryFile, entryCode)
      await this._bundle(bundleEntryFile, bundleFile)
      lazyRemove(bundleEntryFile)
    }
    this.#bundledFiles.set(name, bundleFilename)
    log.info(`  {} ${name} ${colors.dim('• ' + util.formatBytes(Deno.statSync(bundleFile).size))}`)
  }

  /** create polyfill bundle. */
  private async createPolyfillBundle() {
    const alephPkgUri = getAlephPkgUri()
    const { buildTarget } = this.#app.config
    const hash = computeHash(buildTarget + Deno.version.deno + VERSION)
    const bundleFilename = `polyfill.bundle.${hash.slice(0, 8)}.js`
    const bundleFile = path.join(this.#app.buildDir, bundleFilename)
    if (!existsFileSync(bundleFile)) {
      const rawPolyfillFile = `${alephPkgUri}/compiler/polyfills/${buildTarget}/mod.ts`
      await this._bundle(rawPolyfillFile, bundleFile)
    }
    this.#bundledFiles.set('polyfill', bundleFilename)
    log.info(`  {} polyfill (${buildTarget.toUpperCase()}) ${colors.dim('• ' + util.formatBytes(Deno.statSync(bundleFile).size))}`)
  }

  /** run deno bundle and compress the output using terser. */
  private async _bundle(bundleEntryFile: string, bundleFile: string) {
    // todo: use Deno.emit()
    const p = Deno.run({
      cmd: [Deno.execPath(), 'bundle', '--no-check', bundleEntryFile, bundleFile],
      stdout: 'null',
      stderr: 'piped'
    })
    const data = await p.stderrOutput()
    p.close()
    if (!existsFileSync(bundleFile)) {
      const msg = (new TextDecoder).decode(data).replaceAll('file://', '').replaceAll(this.#app.buildDir, '/_aleph')
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
    code = `(() => { ${code} })()`

    // minify code
    // todo: use swc minify instead(https://github.com/swc-project/swc/pull/1302)
    const mini = await minify(code, parseInt(util.trimPrefix(buildTarget, 'es')) as ECMA)
    if (mini !== undefined) {
      code = mini
    }

    await clearCompilation(bundleFile)
    await Deno.writeTextFile(bundleFile, code)
  }
}

async function minify(code: string, ecma: ECMA = 5) {
  const ret = await terser(code, {
    compress: true,
    mangle: true,
    ecma,
    sourceMap: false
  })
  return ret.code
}
