import { join } from 'https://deno.land/std@0.90.0/path/mod.ts'
import { ensureDir } from 'https://deno.land/std@0.90.0/fs/ensure_dir.ts'
import { existsFileSync } from '../shared/fs.ts'
import log from '../shared/log.ts'
import type { LoaderPlugin } from '../types.ts'
import { VERSION } from '../version.ts'
import { checksum } from './dist/wasm-checksum.js'
import init, { parseExportNamesSync, transformSync } from './dist/wasm-pack.js'

export enum SourceType {
  JS = 'js',
  JSX = 'jsx',
  TS = 'ts',
  TSX = 'tsx',
  Unknown = '??',
}

export type ImportMap = {
  imports: Record<string, string>
  scopes: Record<string, Record<string, string>>
}

export type SWCOptions = {
  sourceType?: SourceType
  target?: 'es5' | 'es2015' | 'es2016' | 'es2017' | 'es2018' | 'es2019' | 'es2020'
  jsxFactory?: string
  jsxFragmentFactory?: string
}

export type TransformOptions = {
  importMap?: ImportMap
  reactVersion?: string
  alephPkgUri?: string
  swcOptions?: SWCOptions
  sourceMap?: boolean
  isDev?: boolean
  transpileOnly?: boolean
  resolveStarExports?: boolean
  bundleMode?: boolean
  bundleExternal?: string[]
  // loaders for inline styles transform
  loaders?: LoaderPlugin[]
}

export type TransformResult = {
  code: string
  deps: DependencyDescriptor[]
  starExports: string[] | null
  map: string | null
}

type InlineStyles = Record<string, { type: string, quasis: string[], exprs: string[] }>

type DependencyDescriptor = {
  specifier: string
  isDynamic: boolean
}

let wasmReady: Promise<void> | boolean = false

async function getDenoDir() {
  const p = Deno.run({
    cmd: [Deno.execPath(), 'info', '--json', '--unstable'],
    stdout: 'piped',
    stderr: 'null'
  })
  const output = (new TextDecoder).decode(await p.output())
  p.close()
  return JSON.parse(output).denoDir
}

export async function initWasm() {
  const cacheDir = join(await getDenoDir(), `deps/https/deno.land/aleph@v${VERSION}`)
  const cachePath = `${cacheDir}/compiler.${checksum}.wasm`
  if (existsFileSync(cachePath)) {
    const wasmData = await Deno.readFile(cachePath)
    await init(wasmData)
  } else {
    const { default: getWasmData } = await import('./dist/wasm.js')
    const wasmData = getWasmData()
    await init(wasmData)
    await ensureDir(cacheDir)
    await Deno.writeFile(cachePath, wasmData)
  }
}

/**
 * transform module by swc.
 *
 * ```tsx
 * transform(
 *   '/app.tsx',
 *   `
 *     export default App() {
 *       return <h1>Hello World</h1>
 *     }
 *   `,
 *   {
 *     url: '/app.tsx'
 *     swcOptions: {
 *       target: 'es2020'
 *     }
 *   }
 * )
 * ```
 *
 * @param {string} url - the module URL.
 * @param {string} code - the mocule code.
 * @param {object} options - the transform options.
 */
export async function transform(url: string, code: string, options: TransformOptions = {}): Promise<TransformResult> {
  let t: number | null = null
  if (wasmReady === false) {
    t = performance.now()
    wasmReady = initWasm()
  }
  if (wasmReady instanceof Promise) {
    await wasmReady
    wasmReady = true
  }
  if (t !== null) {
    log.debug(`init compiler wasm in ${Math.round(performance.now() - t)}ms`)
  }

  const { loaders, ...transformOptions } = options
  let {
    code: jsContent,
    deps,
    map,
    inlineStyles,
    starExports
  } = transformSync(url, code, transformOptions)

  // resolve inline-style
  await Promise.all(Object.entries(inlineStyles as InlineStyles).map(async ([key, style]) => {
    let tpl = style.quasis.reduce((tpl, quais, i, a) => {
      tpl += quais
      if (i < a.length - 1) {
        tpl += `%%aleph-inline-style-expr-${i}%%`
      }
      return tpl
    }, '')
      .replace(/\:\s*%%aleph-inline-style-expr-(\d+)%%/g, (_, id) => `: var(--aleph-inline-style-expr-${id})`)
      .replace(/%%aleph-inline-style-expr-(\d+)%%/g, (_, id) => `/*%%aleph-inline-style-expr-${id}%%*/`)
    if (loaders !== undefined) {
      if (style.type !== 'css') {
        for (const loader of loaders) {
          if (loader.test.test(`.${style.type}`)) {
            const { code, type } = await loader.transform({ url: key, content: (new TextEncoder).encode(tpl) })
            if (type === 'css') {
              tpl = code
              break
            }
          }
        }
      }
      for (const loader of loaders) {
        if (loader.test.test('.css')) {
          const { code, type } = await loader.transform({ url: key, content: (new TextEncoder).encode(tpl) })
          if (type === 'css') {
            tpl = code
            break
          }
        }
      }
    }
    tpl = tpl.replace(
      /\: var\(--aleph-inline-style-expr-(\d+)\)/g,
      (_, id) => ': ${' + style.exprs[parseInt(id)] + '}'
    ).replace(
      /\/\*%%aleph-inline-style-expr-(\d+)%%\*\//g,
      (_, id) => '${' + style.exprs[parseInt(id)] + '}'
    )
    jsContent = jsContent.replace(`"%%${key}-placeholder%%"`, '`' + tpl + '`')
  }))

  return { code: jsContent, deps, map, starExports }
}

/* parse export names of the module */
export async function parseExportNames(url: string, code: string, options: SWCOptions = {}): Promise<string[]> {
  let t: number | null = null
  if (wasmReady === false) {
    t = performance.now()
    wasmReady = initWasm()
  }
  if (wasmReady instanceof Promise) {
    await wasmReady
    wasmReady = true
  }
  if (t !== null) {
    log.debug(`init compiler wasm in ${Math.round(performance.now() - t)}ms`)
  }

  return parseExportNamesSync(url, code, options)
}

/**
 * The wasm build checksum.
 */
export const buildChecksum = checksum
