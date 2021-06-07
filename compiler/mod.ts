import { join } from 'https://deno.land/std@0.96.0/path/mod.ts'
import { Measure } from '../shared/log.ts'
import type { ImportMap } from '../types.ts'
import { cache } from '../server/cache.ts'
import { checksum } from './dist/checksum.js'
import init, { parseExportNamesSync, transformSync } from './dist/compiler.js'

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
    ssrOnly: boolean
  }>
  denoHooks?: string[]
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

export async function initWasm() {
  const { url } = import.meta
  if (url.startsWith('file://')) {
    const wasmPath = join(url.slice(7, -7), 'dist', 'compiler.wasm')
    const wasmData = await Deno.readFile(wasmPath)
    await init(wasmData)
  } else {
    const wasmUrl = url.slice(0, -7) + '/dist/compiler.wasm'
    const { content } = await cache(wasmUrl)
    await init(content)
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
 *   `
 * )
 * ```
 */
export async function transform(specifier: string, code: string, options: TransformOptions = {}): Promise<TransformResult> {
  await checkWasmReady()

  const { inlineStylePreprocess, ...transformOptions } = options
  let {
    code: jsContent,
    deps,
    inlineStyles,
    denoHooks,
    starExports,
    map,
  } = transformSync(specifier, code, transformOptions)

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
    denoHooks,
    starExports,
    map
  }
}

/* parse export names of the module */
export async function parseExportNames(specifier: string, code: string, options: SWCOptions = {}): Promise<string[]> {
  await checkWasmReady()
  return parseExportNamesSync(specifier, code, options)
}

/**
 * The wasm build checksum.
 */
export const buildChecksum = checksum
