import { ensureDir, path } from '../deps.ts'
import { existsFileSync } from '../shared/fs.ts'
import type { ImportMap } from '../types.ts'
import { VERSION } from '../version.ts'
import { checksum } from './dist/wasm-checksum.js'
import init, { transformSync } from './dist/wasm-pack.js'

export interface SWCOptions {
    target?: 'es5' | 'es2015' | 'es2016' | 'es2017' | 'es2018' | 'es2019' | 'es2020'
    jsxFactory?: string
    jsxFragmentFactory?: string
    sourceType?: 'js' | 'jsx' | 'ts' | 'tsx'
    sourceMap?: boolean
}

export interface TransformOptions {
    url: string
    importMap?: { imports: ImportMap, scopes: Record<string, ImportMap> }
    reactVersion?: string,
    swcOptions?: SWCOptions
    isDev?: boolean,
    bundleMode?: boolean,
    bundledModules?: string[],
}

interface DependencyDescriptor {
    specifier: string,
    rel?: string
    isDynamic: boolean,
}

export interface TransformResult {
    code: string
    deps: DependencyDescriptor[]
    inlineStyles: Record<string, { type: string, quasis: string[], exprs: string[] }>
    map?: string
}

/**
 * transpile code synchronously by swc.
 *
 * ```tsx
 * transpileSync(`
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
 * @param {object} opts - transform options.
 */
export function transpileSync(code: string, opts?: TransformOptions): TransformResult {
    return transformSync(code, opts)
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
