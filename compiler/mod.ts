import { ensureDir, path } from '../deps.ts'
import { existsFileSync } from '../shared/fs.ts'
import log from '../shared/log.ts'
import { VERSION } from '../version.ts'
import { checksum } from './dist/wasm-checksum.js'
import init, { transformSync } from './dist/wasm-pack.js'

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
  reactVersion?: string
  alephPkgUri?: string
  swcOptions?: SWCOptions
  sourceMap?: boolean
  isDev?: boolean
  transpileOnly?: boolean
  bundleMode?: boolean
  bundleExternal?: string[]
}

export type TransformResult = {
  code: string
  deps: DependencyDescriptor[]
  inlineStyles: Record<string, { type: string, quasis: string[], exprs: string[] }>
  map?: string
}

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

async function initWasm() {
  const cacheDir = path.join(await getDenoDir(), `deps/https/deno.land/aleph@v${VERSION}`)
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
  return transformSync(url, code, options)
}

/**
 * The wasm build checksum.
 */
export const buildChecksum = checksum
