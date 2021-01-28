import type { Plugin } from '../types.ts'

const wasmLoader: Plugin = {
    type: 'loader',
    name: 'wasm-loader',
    test: /.wasm$/,
    transform(content: Uint8Array, path: string) {
        return {
            code: `
                const wasmCode = new Uint8Array([${content.join(',')}])
                const wasmModule = new WebAssembly.Module(wasmCode)
                const { exports } = new WebAssembly.Instance(wasmModule)
                export default exports
            `,
            loader: 'js'
        }
    }
}

export default wasmLoader
