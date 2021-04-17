import { dim } from 'https://deno.land/std@0.93.0/fmt/colors.ts'
import { basename, dirname, join } from 'https://deno.land/std@0.93.0/path/mod.ts'
import { ensureDir, } from 'https://deno.land/std@0.93.0/fs/ensure_dir.ts'
import { transform } from '../compiler/mod.ts'
import { trimModuleExt } from '../framework/core/module.ts'
import { ensureTextFile, existsDirSync, existsFileSync, lazyRemove } from '../shared/fs.ts'
import log from '../shared/log.ts'
import util from '../shared/util.ts'
import { VERSION } from '../version.ts'
import type { Application, Module } from '../server/app.ts'
import { cache } from '../server/cache.ts'
import { computeHash, esbuild, stopEsbuild, getAlephPkgUri } from '../server/helper.ts'

const hashShort = 8
const reHashJS = new RegExp(`\\.[0-9a-f]{${hashShort}}\\.js$`, 'i')

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
    const { buildDir, outputDir } = this.#app
    const bundleFile = join(buildDir, jsFilename)
    const saveAs = join(outputDir, '_aleph', jsFilename)
    await ensureDir(dirname(saveAs))
    await Deno.copyFile(bundleFile, saveAs)
  }

  private async compile(mod: Module, external: string[]): Promise<string> {
    if (this.#compiled.has(mod.url)) {
      return this.#compiled.get(mod.url)!
    }

    const bundlingFile = util.trimSuffix(mod.jsFile, '.js') + '.bundling.js'

    if (existsFileSync(bundlingFile)) {
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
        code = code.replace(`export * from "[${url}]:`, `export {${names.filter(name => name !== 'default').join(',')}} from "`)
        code = code.replace(`export const $$star_${index}`, `export const {${names.filter(name => name !== 'default').join(',')}}`)
      }
    }

    this.#compiled.set(mod.url, bundlingFile)!

    // compile deps
    for (const dep of mod.deps) {
      if (!dep.url.startsWith('#') && !external.includes(dep.url)) {
        const depMod = this.#app.getModule(dep.url)
        if (depMod !== null) {
          await this.compile(depMod, external)
        }
      }
    }

    await ensureTextFile(bundlingFile, code)

    return bundlingFile
  }

  private async createMainJS() {
    const bundled = Array.from(this.#bundled.entries())
      .filter(([name]) => !['polyfill', 'deps', 'shared'].includes(name))
      .reduce((r, [name, filename]) => {
        r[name] = filename
        return r
      }, {} as Record<string, string>)
    const mainJS = `__ALEPH.bundled=${JSON.stringify(bundled)};` + this.#app.getMainJS(true)
    const hash = computeHash(mainJS)
    const bundleFilename = `main.bundle.${hash.slice(0, hashShort)}.js`
    const bundleFilePath = join(this.#app.buildDir, bundleFilename)
    await Deno.writeTextFile(bundleFilePath, mainJS)
    this.#bundled.set('main', bundleFilename)
    log.info(`  {} main.js ${dim('• ' + util.formatBytes(mainJS.length))}`)
  }

  /** create polyfills bundle. */
  private async bundlePolyfillsChunck() {
    const alephPkgUri = getAlephPkgUri()
    const { buildTarget } = this.#app.config
    const polyfillTarget = 'es' + (parseInt(buildTarget.slice(2)) + 1) // buildTarget + 1
    const hash = computeHash(polyfillTarget + '/esbuild@v0.11.11/' + VERSION)
    const bundleFilename = `polyfills.bundle.${hash.slice(0, hashShort)}.js`
    const bundleFilePath = join(this.#app.buildDir, bundleFilename)
    if (!existsFileSync(bundleFilePath)) {
      const rawPolyfillsFile = `${alephPkgUri}/bundler/polyfills/${polyfillTarget}/mod.ts`
      await this.build(rawPolyfillsFile, bundleFilePath)
    }
    this.#bundled.set('polyfills', bundleFilename)
    log.info(`  {} polyfills.js (${buildTarget.toUpperCase()}) ${dim('• ' + util.formatBytes(Deno.statSync(bundleFilePath).size))}`)
  }

  /** create bundle chunk. */
  private async bundleChunk(name: string, entry: string[], external: string[]) {
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
    const bundleFilename = `${name}.bundle.${hash.slice(0, hashShort)}.js`
    const bundleEntryFile = join(this.#app.buildDir, `${name}.bundle.entry.js`)
    const bundleFilePath = join(this.#app.buildDir, bundleFilename)
    if (!existsFileSync(bundleFilePath)) {
      await Deno.writeTextFile(bundleEntryFile, entryCode)
      await this.build(bundleEntryFile, bundleFilePath)
      lazyRemove(bundleEntryFile)
    }
    this.#bundled.set(name, bundleFilename)
    log.info(`  {} ${name}.js ${dim('• ' + util.formatBytes(Deno.statSync(bundleFilePath).size))}`)
  }

  /** run deno bundle and compress the output using terser. */
  private async build(entryFile: string, bundleFile: string) {
    const { buildTarget, browserslist } = this.#app.config

    await clearBuildCache(bundleFile)
    await esbuild({
      entryPoints: [entryFile],
      outfile: bundleFile,
      platform: 'browser',
      target: [String(buildTarget)].concat(browserslist.map(({ name, version }) => {
        return `${name.toLowerCase()}${version}`
      })),
      bundle: true,
      minify: true,
      treeShaking: true,
      sourcemap: false,
      plugins: [{
        name: 'http-loader',
        setup(build) {
          build.onResolve({ filter: /.*/ }, args => {
            if (util.isLikelyHttpURL(args.path)) {
              return {
                path: args.path,
                namespace: 'http-module',
              }
            }
            if (args.namespace === 'http-module') {
              return {
                path: (new URL(args.path, args.importer)).toString(),
                namespace: 'http-module',
              }
            }
            const [path] = util.splitBy(util.trimPrefix(args.path, 'file://'), '#')
            if (path.startsWith('.')) {
              return { path: join(args.resolveDir, path) }
            }
            return { path }
          })
          build.onLoad({ filter: /.*/, namespace: 'http-module' }, async args => {
            const { content } = await cache(args.path)
            return { contents: content }
          })
        }
      }],
    })
  }
}

export function simpleJSMinify(code: string) {
  return code.split('\n').map(l => l.trim()
    .replace(/\s*([,:=|+]{1,2})\s+/g, '$1')
    .replaceAll(') {', '){')
  ).join('')
}

async function clearBuildCache(filename: string) {
  const dir = dirname(filename)
  const hashname = basename(filename)
  if (!reHashJS.test(hashname) || !existsDirSync(dir)) {
    return
  }

  const jsName = hashname.split('.').slice(0, -2).join('.') + '.js'
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && reHashJS.test(entry.name)) {
      const _jsName = entry.name.split('.').slice(0, -2).join('.') + '.js'
      if (_jsName === jsName && hashname !== entry.name) {
        await Deno.remove(join(dir, entry.name))
      }
    }
  }
}
