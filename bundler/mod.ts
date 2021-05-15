import { dirname, join } from 'https://deno.land/std@0.96.0/path/mod.ts'
import { ensureDir } from 'https://deno.land/std@0.96.0/fs/ensure_dir.ts'
import { transform } from '../compiler/mod.ts'
import { trimModuleExt } from '../framework/core/module.ts'
import { ensureTextFile, existsFile, lazyRemove } from '../shared/fs.ts'
import util from '../shared/util.ts'
import type { BrowserNames } from '../types.ts'
import { VERSION } from '../version.ts'
import type { Application, Module } from '../server/app.ts'
import { clearBuildCache, computeHash, getAlephPkgUri } from '../server/helper.ts'
import { esbuild, stopEsbuild, esbuildUrlLoader } from './esbuild.ts'

export const bundlerRuntimeCode = `
  window.__ALEPH = {
    basePath: '/',
    pack: {},
    bundled: {},
    import: function(u, F) {
      var b = this.basePath,
          a = this.pack,
          l = this.bundled;
      if (u in a) {
        return Promise.resolve(a[u]);
      }
      return new Promise(function(y, n) {
        var s = document.createElement('script'),
            f = l[u] || l[u.replace(/\\.[a-zA-Z0-9]+$/, '')],
            p = (b + '/_aleph').replace('//', '/');
        if (!f) {
          n(new Error('invalid url: ' + u));
          return;
        }
        s.onload = function() {
          y(a[u]);
        };
        s.onerror = n;
        p += f;
        if (F) {
          p += '?t=' + (new Date).getTime();
        }
        s.src = p;
        document.body.appendChild(s);
      })
    }
  }
`

/** The bundler class for aleph server. */
export class Bundler {
  #app: Application
  #bundled: Map<string, string>
  #compiled: Map<string, string>

  constructor(app: Application) {
    this.#app = app
    this.#bundled = new Map()
    this.#compiled = new Map()
  }

  async bundle(entryMods: Array<{ url: string, shared: boolean }>) {
    const remoteEntries = new Set<string>()
    const sharedEntries = new Set<string>()
    const entries = new Set<string>()

    entryMods.forEach(({ url, shared }) => {
      if (shared) {
        if (util.isLikelyHttpURL(url)) {
          remoteEntries.add(url)
        } else {
          sharedEntries.add(url)
        }
      } else {
        entries.add(url)
      }
    })

    if (this.#app.config.buildTarget !== 'esnext') {
      await this.bundlePolyfillsChunck()
    }
    await this.bundleChunk(
      'deps',
      Array.from(remoteEntries),
      []
    )
    if (sharedEntries.size > 0) {
      await this.bundleChunk(
        'shared',
        Array.from(sharedEntries),
        Array.from(remoteEntries)
      )
    }
    for (const url of entries) {
      await this.bundleChunk(
        trimModuleExt(url),
        [url],
        [
          Array.from(remoteEntries),
          Array.from(sharedEntries)
        ].flat()
      )
    }

    // create main.js after all chunks are bundled
    await this.createMainJS()

    // unlike nodejs, Deno doesn't provide the necessary APIs to allow Deno to
    // exit while esbuild's internal child process is still running.
    stopEsbuild()
  }

  getBundledFile(name: string): string | null {
    return this.#bundled.get(name) || null
  }

  async copyDist() {
    await Promise.all(
      Array.from(this.#bundled.values()).map(jsFile => this.copyBundleFile(jsFile))
    )
  }

  private async copyBundleFile(jsFilename: string) {
    const { workingDir, buildDir, config } = this.#app
    const outputDir = join(workingDir, config.outputDir)
    const bundleFile = join(buildDir, jsFilename)
    const saveAs = join(outputDir, '_aleph', jsFilename)
    await ensureDir(dirname(saveAs))
    await Deno.copyFile(bundleFile, saveAs)
  }

  private async compile(mod: Module, external: string[]): Promise<string> {
    if (this.#compiled.has(mod.url)) {
      return this.#compiled.get(mod.url)!
    }

    const jsFile = join(this.#app.buildDir, mod.jsFile.slice(0, -3) + '.client.js')
    this.#compiled.set(mod.url, jsFile)

    if (await existsFile(jsFile)) {
      return jsFile
    }

    const source = await this.#app.loadModule(mod.url)
    if (source === null) {
      this.#compiled.delete(mod.url)
      throw new Error(`Unsupported module '${mod.url}'`)
    }

    try {
      let { code, starExports } = await transform(
        mod.url,
        source.code,
        {
          ...this.#app.commonCompileOptions,
          swcOptions: {
            sourceType: source.type,
          },
          bundleMode: true,
          bundleExternal: external,
        }
      )

      if (starExports && starExports.length > 0) {
        for (let index = 0; index < starExports.length; index++) {
          const url = starExports[index]
          const names = await this.#app.parseModuleExportNames(url)
          code = code.replaceAll(`export * from "[${url}]:`, `export {${names.filter(name => name !== 'default').join(',')}} from "`)
          code = code.replaceAll(`export const $$star_${index}`, `export const {${names.filter(name => name !== 'default').join(',')}}`)
        }
      }

      // compile deps
      await Promise.all(mod.deps.map(async dep => {
        if (!dep.url.startsWith('#') && !external.includes(dep.url)) {
          const depMod = this.#app.getModule(dep.url)
          if (depMod !== null) {
            await this.compile(depMod, external)
          }
        }
      }))

      await ensureTextFile(jsFile, code)
      return jsFile
    } catch (e) {
      this.#compiled.delete(mod.url)
      throw new Error(`Can't compile module '${mod.url}': ${e.message}`)
    }
  }

  private async createMainJS() {
    const bundled = Array.from(this.#bundled.entries())
      .filter(([name]) => !['polyfills', 'deps', 'shared'].includes(name))
      .reduce((r, [name, filename]) => {
        r[name] = filename
        return r
      }, {} as Record<string, string>)
    const mainJS = `__ALEPH.bundled=${JSON.stringify(bundled)};` + this.#app.getMainJS(true)
    const hash = computeHash(mainJS)
    const bundleFilename = `main.bundle.${hash.slice(0, 8)}.js`
    const bundleFilePath = join(this.#app.buildDir, bundleFilename)
    await Deno.writeTextFile(bundleFilePath, mainJS)
    this.#bundled.set('main', bundleFilename)
  }

  /** create polyfills bundle. */
  private async bundlePolyfillsChunck() {
    const alephPkgUri = getAlephPkgUri()
    const { buildTarget } = this.#app.config
    const polyfillTarget = 'es' + (parseInt(buildTarget.slice(2)) + 1) // buildTarget + 1
    const hash = computeHash(polyfillTarget + '/esbuild@v0.11.11/' + VERSION)
    const bundleFilename = `polyfills.bundle.${hash.slice(0, 8)}.js`
    const bundleFilePath = join(this.#app.buildDir, bundleFilename)
    if (!await existsFile(bundleFilePath)) {
      const rawPolyfillsFile = `${alephPkgUri}/bundler/polyfills/${polyfillTarget}/mod.ts`
      await this.build(rawPolyfillsFile, bundleFilePath)
    }
    this.#bundled.set('polyfills', bundleFilename)
  }

  /** create bundle chunk. */
  private async bundleChunk(name: string, entry: string[], external: string[]) {
    const entryCode = (await Promise.all(entry.map(async (url, i) => {
      const { buildDir } = this.#app
      let mod = this.#app.getModule(url)
      if (mod && mod.jsFile !== '') {
        if (external.length === 0) {
          return [
            `import * as mod_${i} from ${JSON.stringify('file://' + join(buildDir, mod.jsFile))}`,
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
    const bundleEntryFile = join(this.#app.buildDir, `${name}.bundle.entry.js`)
    const bundleFilePath = join(this.#app.buildDir, bundleFilename)
    if (!await existsFile(bundleFilePath)) {
      await Deno.writeTextFile(bundleEntryFile, entryCode)
      await this.build(bundleEntryFile, bundleFilePath)
      lazyRemove(bundleEntryFile)
    }
    this.#bundled.set(name, bundleFilename)
  }

  /** run deno bundle and compress the output using terser. */
  private async build(entryFile: string, bundleFile: string) {
    const { buildTarget, browserslist } = this.#app.config

    await clearBuildCache(bundleFile)
    await esbuild({
      entryPoints: [entryFile],
      outfile: bundleFile,
      platform: 'browser',
      format: 'iife',
      target: [String(buildTarget)].concat(Object.keys(browserslist).map(name => {
        return `${name}${browserslist[name as BrowserNames]}`
      })),
      bundle: true,
      minify: true,
      treeShaking: true,
      sourcemap: false,
      plugins: [esbuildUrlLoader],
    })
  }
}

export function simpleJSMinify(code: string) {
  return code.split('\n').map(l => l.trim()
    .replace(/\s*([,:=|+]{1,2})\s+/g, '$1')
    .replaceAll(') {', '){')
  ).join('')
}
