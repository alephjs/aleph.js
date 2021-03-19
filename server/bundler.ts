import { minify as terser, ECMA } from 'https://esm.sh/terser@5.5.1'
import { transform } from '../compiler/mod.ts'
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

export const createBundlerRuntimeCode = () => minify(`
  window.__ALEPH = {
    baseURL: '/'
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
`)

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

    console.log(remoteEntries)
    console.log(sharedEntries)
    console.log(entries)


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
          [
            ...remoteEntries,
            ...sharedEntries
          ]
        )
      })
    ])
  }

  #compiled = new Set<string>()

  private async compile(mod: Module, external: string[]): Promise<[string, Boolean]> {
    const bundlingFile = util.trimSuffix(mod.jsFile, '.js') + '.bundling.js'

    if (this.#compiled.has(mod.url)) {
      return [bundlingFile, false]
    }
    this.#compiled.add(mod.url)
    // let shouldCompile = false
    // this.#app.lookupDeps(mod.url, dep => {
    //   if (external.includes(dep.url)) {
    //     shouldCompile = true
    //     return false
    //   }
    // })
    // if (!shouldCompile) {
    //   return [mod.jsFile, false]
    // }

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
          const [_, isBundling] = await this.compile(depMod, external)
          const s = `.bundling.js#${dep.url}@`
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
    return [bundlingFile, true]
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
          const [jsFile] = await this.compile(mod, external)
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
    const hash = computeHash(buildTarget + Deno.version.deno + VERSION)
    const bundleFile = path.join(this.#app.buildDir, `polyfill.bundle.${hash.slice(0, 8)}.js`)
    if (!existsFileSync(bundleFile)) {
      const rawPolyfillFile = `${alephPkgUri}/compiler/polyfills/${buildTarget}/mod.ts`
      await this.runDenoBundle(rawPolyfillFile, bundleFile)
    }
    log.info(`  {} polyfill (${buildTarget.toUpperCase()}) ${colors.dim('• ' + util.formatBytes(Deno.statSync(bundleFile).size))}`)
  }

  /** run deno bundle and compress the output using terser. */
  private async runDenoBundle(bundleEntryFile: string, bundleFile: string) {
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
  return (await terser(code, {
    compress: true,
    mangle: true,
    ecma,
    sourceMap: false
  })).code
}
