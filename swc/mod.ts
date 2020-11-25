import { default as init_wasm, transformSync } from './aleph_swc.js';
import getWasmData from './aleph_swc.wasm.js';

type ImportMap = Record<string, string[]>

export interface SWCOptions {
    target?: 'es2015' | 'es2016' | 'es2017' | 'es2018' | 'es2019' | 'es2020'
    jsxFactory?: string
    jsxFragmentFactory?: string
    sourceType?: 'js' | 'jsx' | 'ts' | 'tsx'
    sourceMap?: boolean
    isDev?: boolean,
}

export interface TransformOptions {
    filename: string
    importMap?: { imports: ImportMap, scopes: Record<string, ImportMap> }
    swcOptions?: SWCOptions
}

interface DependencyDescriptor {
    specifier: string,
    isDynamic: boolean,
    isData: boolean,
}

export interface TransformRet {
    code: string
    map?: string
    deps: DependencyDescriptor[]
}

/**
 * transpile code synchronously by swc.
 *
 * ```javascript
 * transpileSync(`
 *   export default App() {
 *     return <h1>Hello World</h1>
 *   }
 * `, {
 *   filename: '/app.tsx'
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
export const initSWC = async () => await init_wasm(getWasmData())
