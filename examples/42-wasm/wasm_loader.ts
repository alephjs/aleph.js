import type { Plugin } from 'aleph/types.d.ts'

export default <Plugin>{
  name: 'wasm-loader',
  setup: aleph => {
    aleph.onLoad(/\.wasm$/i, async ({ specifier }) => {
      const { content } = await aleph.fetchModule(specifier)
      return {
        code: [
          `const wasmBytes = new Uint8Array([${content.join(',')}])`,
          'const wasmModule = new WebAssembly.Module(wasmBytes)',
          'const { exports } = new WebAssembly.Instance(wasmModule)',
          'export default exports',
        ].join('\n')
      }
    })
  }
}
