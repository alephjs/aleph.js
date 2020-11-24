import { default as init_wasm, transformSync } from './aleph_swc.js';

type ImportMap = Record<string, string[]>

export interface SWCOptions {
    target?: 'es2015' | 'es2016' | 'es2017' | 'es2018' | 'es2019' | 'es2020'
    jsxFactory?: string
    jsxFragmentFactory?: string
    sourceMap?: boolean
    isDev?: boolean,
}

export interface TransformOptions {
    filename: string
    importMap?: { imports: ImportMap, scopes: Record<string, ImportMap> }
    swcOptions?: SWCOptions
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
export default function transpileSync(code: string, opts?: TransformOptions) {
    transformSync(code, opts)
}

/**
 * load and initiate compiler wasm.
 */
export const init = async () => {
    const { default: getWasmData } = await import('./aleph_swc.wasm.js')
    init_wasm(getWasmData())
}
