import { ensureDir, path } from '../deps.ts'
import { existsFileSync } from '../shared/fs.ts'
import { VERSION } from '../version.ts'
import { checksum } from './dist/wasm-checksum.js'
import init, { transformSync as swc } from './dist/wasm-pack.js'

export type ImportMap = {
  imports: Record<string, string>
  scopes: Record<string, Record<string, string>>
}

export type SWCOptions = {
  sourceType?: 'js' | 'jsx' | 'ts' | 'tsx'
  target?: 'es5' | 'es2015' | 'es2016' | 'es2017' | 'es2018' | 'es2019' | 'es2020'
  jsxFactory?: string
  jsxFragmentFactory?: string
}

export type TransformOptions = {
  importMap?: ImportMap
  reactVersion?: string,
  alephModuleUrl?: string,
  swcOptions?: SWCOptions
  sourceMap?: boolean
  isDev?: boolean,
  bundleMode?: boolean,
  bundleExternal?: string[],
}

export type TransformResult = {
  code: string
  deps: DependencyDescriptor[]
  inlineStyles: Record<string, { type: string, quasis: string[], exprs: string[] }>
  map?: string
}

type DependencyDescriptor = {
  specifier: string,
  rel?: string
  isDynamic: boolean,
}

/**
 * transpile code synchronously by swc.
 *
 * ```tsx
 * transformSync(`
 *   export default App() {
 *     return <h1>Hello World</h1>
 *   }
 * `,
 * {
 *   url: '/app.tsx'
 *   swcOptions: {
 *     target: 'es2020'
 *   }
 * })
 * ```
 *
 * @param {string} code - code string.
 * @param {object} options - transform options.
 */
export function transformSync(url: string, code: string, options: TransformOptions = {}): TransformResult {
  return swc(url, code, options)
}

/**
 * initiate the compiler wasm.
 */
export const initWasm = async (denoCacheDir: string) => {
  const cacheDir = path.join(denoCacheDir, `deps/https/deno.land/aleph@v${VERSION}`)
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
 * The wasm build checksum.
 */
export const buildChecksum = checksum
