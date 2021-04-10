import { dim } from 'https://deno.land/std@0.92.0/fmt/colors.ts'
import * as path from 'https://deno.land/std@0.92.0/path/mod.ts'
import { ensureDir } from 'https://deno.land/std@0.92.0/fs/ensure_dir.ts'
import { parseExportNames, transform } from '../compiler/mod.ts'
import { trimModuleExt } from '../framework/core/module.ts'
import { ensureTextFile, existsFileSync, lazyRemove } from '../shared/fs.ts'
import log from '../shared/log.ts'
import util from '../shared/util.ts'
import { VERSION } from '../version.ts'
import type { Application, Module } from '../server/app.ts'
import {
  clearCompilation,
  computeHash,
  getAlephPkgUri,
} from '../server/helper.ts'

export const bundlerRuntimeCode = (`
  window.__ALEPH = {
    baseURL: '/',
    pack: {},
    bundledFiles: {},
    import: function(u, F) {
      var b = this.baseURL,
          a = this.pack,
          l = this.bundledFiles;
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
`).split('\n')
  .map(l => l.trim()
    .replaceAll(') {', '){')
    .replace(/\s*([,:=|+]{1,2})\s+/g, '$1')
  )
  .join('')

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

    await this.createPolyfillBundle()
    await this.createBundleChunk(
      'deps',
      Array.from(remoteEntries),
      []
    )
    if (sharedEntries.size > 0) {
      await this.createBundleChunk(
        'shared',
        Array.from(sharedEntries),
        Array.from(remoteEntries)
      )
    }
    for (const url of entries) {
      await this.createBundleChunk(
        trimModuleExt(url),
        [url],
        [
          Array.from(remoteEntries),
          Array.from(sharedEntries)
        ].flat()
      )
    }
    await this.createMainJS()
  }

  getBundledFile(name: string): string | null {
    return this.#bundledFiles.get(name) || null
  }

  async copyDist() {
    await Promise.all(
      Array.from(this.#bundledFiles.values()).map(jsFile => this.copyBundleFile(jsFile))
    )
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

    const source = await this.#app.resolveModule(mod.url)
    if (source === null) {
      throw new Error(`Unsupported module '${mod.url}'`)
    }

    let { code, starExports } = await transform(
      mod.url,
      source.code,
      {
        ...this.#app.sharedCompileOptions,
        swcOptions: {
          target: 'es2020',
          sourceType: source.type,
        },
        bundleMode: true,
        bundleExternal: external,
      }
    )

    if (starExports && starExports.length > 0) {
      for (let index = 0; index < starExports.length; index++) {
        const url = starExports[index]
        const source = await this.#app.resolveModule(url)
        const names = await parseExportNames(url, source.code, { sourceType: source.type })
        code = code.replace(`export const $$star_${index}`, `export const {${names.filter(name => name !== 'default').join(',')}}`)
      }
    }

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

  private async createMainJS() {
    const bundledFiles = Array.from(this.#bundledFiles.entries())
      .filter(([name]) => !['polyfill', 'deps', 'shared'].includes(name))
      .reduce((r, [name, filename]) => {
        r[name] = filename
        return r
      }, {} as Record<string, string>)
    const mainJS = `__ALEPH.bundledFiles=${JSON.stringify(bundledFiles)};` + this.#app.getMainJS(true)
    const hash = computeHash(mainJS)
    const bundleFilename = `main.bundle.${hash.slice(0, 8)}.js`
    const bundleFile = path.join(this.#app.buildDir, bundleFilename)
    await Deno.writeTextFile(bundleFile, mainJS)
    this.#bundledFiles.set('main', bundleFilename)
    log.info(`  {} main.js ${dim('• ' + util.formatBytes(mainJS.length))}`)
  }

  /** create polyfill bundle. */
  private async createPolyfillBundle() {
    const alephPkgUri = getAlephPkgUri()
    const { buildTarget } = this.#app.config
    const hash = computeHash(buildTarget + Deno.version.deno + VERSION)
    const bundleFilename = `polyfill.bundle.${hash.slice(0, 8)}.js`
    const bundleFile = path.join(this.#app.buildDir, bundleFilename)
    if (!existsFileSync(bundleFile)) {
      const rawPolyfillFile = `${alephPkgUri}/bundler/polyfills/${buildTarget}/mod.ts`
      await this._bundle(rawPolyfillFile, bundleFile)
    }
    this.#bundledFiles.set('polyfill', bundleFilename)
    log.info(`  {} polyfill.js (${buildTarget.toUpperCase()}) ${dim('• ' + util.formatBytes(Deno.statSync(bundleFile).size))}`)
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
    log.info(`  {} ${name}.js ${dim('• ' + util.formatBytes(Deno.statSync(bundleFile).size))}`)
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
    // todo: use swc minify instead (https://github.com/swc-project/swc/pull/1302)
    const mini = await minify(code, parseInt(util.trimPrefix(buildTarget, 'es')))
    if (mini !== undefined) {
      code = mini
    }

    await clearCompilation(bundleFile)
    await Deno.writeTextFile(bundleFile, code)
  }
}

interface Minify {
  (code: string, options: any): Promise<{ code: string }>
}

let terser: Minify | null = null

async function minify(code: string, ecma: number = 2015) {
  if (terser === null) {
    const { minify } = await import('https://esm.sh/terser@5.6.1?no-check')
    terser = minify as Minify
  }
  const ret = await terser(code, {
    compress: true,
    mangle: true,
    ecma,
    sourceMap: false
  })
  return ret.code
}
