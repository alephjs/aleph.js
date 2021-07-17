import type { Plugin } from 'aleph/types.ts'

export default (): Plugin => ({
  name: 'wasm-loader',
  setup(aleph) {
    aleph.addModuleLoader({
      test: /\.wasm$/i,
      load: async ({ specifier }, aleph) => {
        const { content } = await aleph.fetchModule(specifier)
        return {
          code: [
            `const wasmBytes = new Uint8Array([${content.join(',')}])`,
            'const wasmModule = new WebAssembly.Module(wasmBytes)',
            'const { exports } = new WebAssembly.Instance(wasmModule)',
            'export default exports',
          ].join('\n')
        }
      }
    })
  }
})
