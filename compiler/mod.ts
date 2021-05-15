import { join } from 'https://deno.land/std@0.96.0/path/mod.ts'
import { ensureDir } from 'https://deno.land/std@0.96.0/fs/ensure_dir.ts'
import { existsFile } from '../shared/fs.ts'
import { Measure } from '../shared/log.ts'
import type { ImportMap } from '../types.ts'
import { VERSION } from '../version.ts'
import { checksum } from './dist/wasm-checksum.js'
import init, { parseExportNamesSync, transformSync } from './dist/wasm-pack.js'

export enum SourceType {
  JS = 'js',
  JSX = 'jsx',
  TS = 'ts',
  TSX = 'tsx',
  CSS = 'css',
  Unknown = '??',
}

export type ReactResolve = {
  version: string,
  esmShBuildVersion: number
}

export type SWCOptions = {
  sourceType?: SourceType
  jsxFactory?: string
  jsxFragmentFactory?: string
}

export type TransformOptions = {
  importMap?: ImportMap
  alephPkgUri?: string
  react?: ReactResolve
  swcOptions?: SWCOptions
  sourceMap?: boolean
  isDev?: boolean
  bundleMode?: boolean
  bundleExternal?: string[]
  inlineStylePreprocess?(key: string, type: string, tpl: string): Promise<string>
}

export type TransformResult = {
  code: string
  deps: Array<{
    specifier: string
    importIndex: string
    isDynamic: boolean
  }>
  useDenoHooks?: string[]
  starExports?: string[]
  map?: string
}

type InlineStyle = {
  type: string,
  quasis: string[],
  exprs: string[]
}

type InlineStyleRecord = Record<string, InlineStyle>

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
  if (await existsFile(cachePath)) {
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

async function checkWasmReady() {
  let ms: Measure | null = null
  if (wasmReady === false) {
    ms = new Measure()
    wasmReady = initWasm()
  }
  if (wasmReady instanceof Promise) {
    await wasmReady
    wasmReady = true
  }
  if (ms !== null) {
    ms.stop('init compiler wasm')
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
  await checkWasmReady()

  const { inlineStylePreprocess, ...transformOptions } = options
  let {
    code: jsContent,
    deps,
    inlineStyles,
    useDenoHooks,
    starExports,
    map,
  } = transformSync(url, code, transformOptions)

  // resolve inline-style
  if (inlineStyles) {
    await Promise.all(Object.entries(inlineStyles as InlineStyleRecord).map(async ([key, style]) => {
      let tpl = style.quasis.reduce((tpl, quais, i, a) => {
        tpl += quais
        if (i < a.length - 1) {
          tpl += `%%aleph-inline-style-expr-${i}%%`
        }
        return tpl
      }, '')
        .replace(/\:\s*%%aleph-inline-style-expr-(\d+)%%/g, (_, id) => `: var(--aleph-inline-style-expr-${id})`)
        .replace(/%%aleph-inline-style-expr-(\d+)%%/g, (_, id) => `/*%%aleph-inline-style-expr-${id}%%*/`)
      if (inlineStylePreprocess !== undefined) {
        tpl = await inlineStylePreprocess('#' + key, style.type, tpl)
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
  }

  return {
    code: jsContent,
    deps,
    useDenoHooks,
    starExports,
    map
  }
}

/* parse export names of the module */
export async function parseExportNames(url: string, code: string, options: SWCOptions = {}): Promise<string[]> {
  await checkWasmReady()
  return parseExportNamesSync(url, code, options)
}

/**
 * The wasm build checksum.
 */
export const buildChecksum = checksum
