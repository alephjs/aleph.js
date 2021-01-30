import type { LoaderPlugin } from '../types.ts'

const wasmLoader: LoaderPlugin = {
    type: 'loader',
    test: /.wasm$/,
    transform: (content: Uint8Array, path: string) => ({
        code: `
            const wasmBytes = new Uint8Array([${content.join(',')}])
            const wasmModule = new WebAssembly.Module(wasmBytes)
            const { exports } = new WebAssembly.Instance(wasmModule)
            export default exports
        `,
        format: 'js'
    })
}

export default wasmLoader
