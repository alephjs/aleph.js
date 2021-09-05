import { dirname, join } from 'https://deno.land/std@0.106.0/path/mod.ts'
import { ensureDir } from 'https://deno.land/std@0.106.0/fs/ensure_dir.ts'
import { esbuild } from '../bundler/esbuild.ts'
import { trimBuiltinModuleExts } from '../framework/core/module.ts'
import { existsFile } from '../shared/fs.ts'
import { Measure } from '../shared/log.ts'
import util from '../shared/util.ts'
import { decoder, getDenoDir, toLocalPath, toRelativePath } from '../server/helper.ts'
import type { ImportMap } from '../types.d.ts'
import { checksum } from './dist/checksum.js'
import init, { parseExportNamesSync, stripSsrCodeSync, transformSync } from './dist/compiler.js'

export enum SourceType {
  JS = 'js',
  JSX = 'jsx',
  TS = 'ts',
  TSX = 'tsx',
  CSS = 'css',
  Unknown = '??',
}

export type ModuleSource = {
  code: string
  type: SourceType
  map?: string
}

export type SWCOptions = {
  sourceType?: SourceType
  jsxFactory?: string
  jsxFragmentFactory?: string
}

export type ReactOptions = {
  version: string,
  esmShBuildVersion: number
}

export type TransformOptions = {
  alephPkgUri?: string
  workingDir?: string
  importMap?: ImportMap
  swcOptions?: SWCOptions
  react?: ReactOptions
  sourceMap?: boolean
  isDev?: boolean
  httpExternal?: boolean
  bundleMode?: boolean
  bundleExternals?: string[]
  inlineStylePreprocess?(key: string, type: string, tpl: string): Promise<string>
}

export type TransformResult = {
  code: string
  deps?: RawDependencyDescriptor[]
  ssrPropsFn?: string
  ssgPathsFn?: boolean
  denoHooks?: string[]
  starExports?: string[]
  jsxStaticClassNames?: string[]
  map?: string
}

type RawDependencyDescriptor = {
  specifier: string
  resolved: string
  isDynamic: boolean
}

type InlineStyle = {
  type: string,
  quasis: string[],
  exprs: string[]
}

type InlineStyles = Record<string, InlineStyle>

let wasmReady: Promise<void> | boolean = false

async function initWasm() {
  const cacheDir = join(await getDenoDir(), `deps/https/deno.land/aleph`)
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
 * Transforms the module with esbuild/swc.
 *
 * ```tsx
 * transform(
 *   '/app.tsx',
 *   `
 *    import React from 'https://esm.sh/react';
 *
 *    export default App() {
 *      return <h1>Hello World</h1>
 *    }
 *   `
 * )
 * ```
 */
export async function transform(specifier: string, code: string, options: TransformOptions = {}): Promise<TransformResult> {
  await checkWasmReady()

  const { inlineStylePreprocess, ...transformOptions } = options
  let { code: jsContent, inlineStyles, ...rest } = transformSync(specifier, code, transformOptions)

  // resolve inline-style
  if (inlineStyles) {
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
      if (inlineStylePreprocess !== undefined) {
        tpl = await inlineStylePreprocess('#' + key, style.type, tpl)
      }
      tpl = tpl.replace(
        /\:\s*var\(--aleph-inline-style-expr-(\d+)\)/g,
        (_, id) => ': ${' + style.exprs[parseInt(id)] + '}'
      ).replace(
        /\/\*%%aleph-inline-style-expr-(\d+)%%\*\//g,
        (_, id) => '${' + style.exprs[parseInt(id)] + '}'
      )
      jsContent = jsContent.replace(`"%%${key}-placeholder%%"`, '`' + tpl + '`')
    }))
  }

  return { code: jsContent, ...rest }
}

export async function fastTransform(specifier: string, source: ModuleSource, { react }: TransformOptions = {}): Promise<TransformResult> {
  if (!util.isLikelyHttpURL(specifier)) {
    throw new Error('Expect a remote(http) module')
  }
  if (source.type === SourceType.Unknown) {
    throw new Error('Unknown source type')
  }
  if (source.type === SourceType.JSX || source.type === SourceType.TSX || source.type === SourceType.CSS) {
    throw new Error('Expect non-jsx/css module')
  }
  const deps: RawDependencyDescriptor[] = []
  const r = await esbuild({
    stdin: {
      loader: source.type,
      contents: source.code,
      sourcefile: specifier,
    },
    format: 'esm',
    write: false,
    bundle: true,
    plugins: [{
      name: 'module-resolver',
      setup(build) {
        build.onResolve({ filter: /.*/ }, args => {
          if (args.kind === 'entry-point') {
            return { path: args.path }
          }

          const isRemote = util.isLikelyHttpURL(args.path)
          const url = new URL(args.path, !isRemote ? specifier : undefined)

          if (react) {
            if (url.hostname === 'esm.sh' || url.hostname === 'cdn.esm.sh' || url.hostname === 'esm.x-static.io') {
              const a = url.pathname.split('/').filter(Boolean)
              const v = Boolean(a[0]) && a[0].startsWith('v')
              const n = v ? a[1] : a[0]
              if (n) {
                const prefix = v ? '/v' + react.esmShBuildVersion + '/' : '/'
                const subPath = '@' + react.version + '/' + a.slice(v ? 2 : 1).join('/')
                if (n === 'react' || n === 'react-dom') {
                  url.pathname = prefix + n + subPath
                }
                if (n.startsWith('react@') || n.startsWith('react-dom@')) {
                  url.pathname = prefix + n.split('@')[0] + subPath
                }
              }
            }
          }

          const path = util.trimSuffix(url.toString(), '/')
          const resolved = toRelativePath(
            dirname(toLocalPath(specifier)),
            toLocalPath(trimBuiltinModuleExts(path) + '.js')
          )
          deps.push({
            specifier: path,
            resolved,
            isDynamic: args.kind === 'dynamic-import',
          })
          return { path: resolved, external: true }
        })
      }
    }],
  })

  return {
    code: decoder.decode(r.outputFiles[0].contents),
    deps
  }
}

/* strip SSR code. */
export async function stripSsrCode(specifier: string, code: string, options: TransformOptions = {}): Promise<TransformResult> {
  await checkWasmReady()
  return stripSsrCodeSync(specifier, code, options)
}

/* parse export names of the module. */
export async function parseExportNames(specifier: string, code: string, options: SWCOptions = {}): Promise<string[]> {
  await checkWasmReady()
  return parseExportNamesSync(specifier, code, options)
}

/**
 * The wasm checksum.
 */
export const wasmChecksum = checksum
