import { path } from '../deps.ts';
import log from '../log.ts';
import { existsFileSync } from '../util.ts';
import { checksum } from './wasm-checksum.js';
import { default as init_wasm, transformSync } from './wasm-pack.js';

type ImportMap = Record<string, ReadonlyArray<string>>

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
    reactUrl?: string,
    reactDomUrl?: string,
    swcOptions?: SWCOptions
    isDev?: boolean,
    bundleMode?: boolean,
    bundledPaths?: string[],
}

interface DependencyDescriptor {
    specifier: string,
    isDynamic: boolean,
}

export interface TransformRet {
    code: string
    map?: string
    deps: DependencyDescriptor[]
    inlineStyles: Record<string, { type: string, quasis: string[], exprs: string[] }>
}

/**
 * transpile code synchronously by swc.
 *
 * ```javascript
 * transpileSync(
 * `
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
 */
export function transpileSync(code: string, opts?: TransformOptions): TransformRet {
    return transformSync(code, opts)
}

/**
 * load and initiate compiler wasm.
 */
export const initSWC = async (denoCacheDir: string) => {
    const t = performance.now()
    const cachePath = path.join(denoCacheDir, `deps/https/deno.land/aleph_compiler.${checksum}.wasm`)
    if (existsFileSync(cachePath)) {
        const wasmData = await Deno.readFile(cachePath)
        await init_wasm(wasmData)
    } else {
        const { default: getWasmData } = await import('./wasm.js')
        const wasmData = getWasmData()
        await Promise.all([
            init_wasm(wasmData),
            Deno.writeFile(cachePath, wasmData)
        ])
    }
    log.debug('init swc wasm in ' + Math.round(performance.now() - t) + 'ms')
}
