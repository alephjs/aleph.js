import { } from "https://deno.land/std@0.74.0/encoding/base64.ts"

export default {
    plugins: [{
        test: /.wasm$/,
        transform(content: Uint8Array) {
            return {
                code: `
                    const wasmCode = new Uint8Array([${content.join(',')}])
                    const wasmModule = new WebAssembly.Module(wasmCode)
                    const wasmInstance = new WebAssembly.Instance(wasmModule)
                    export default wasmInstance.exports
                `,
                loader: 'js'
            }
        }
    }]
}