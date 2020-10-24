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