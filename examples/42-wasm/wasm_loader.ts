import type { LoaderPlugin } from '../../types.ts'

export default (): LoaderPlugin => ({
  name: 'wasm-loader',
  type: 'loader',
  test: /\.wasm$/i,
  transform: ({ content }) => ({
    code: [
      `const wasmBytes = new Uint8Array([${content.join(',')}])`,
      'const wasmModule = new WebAssembly.Module(wasmBytes)',
      'const { exports } = new WebAssembly.Instance(wasmModule)',
      'export default exports',
    ].join('\n')
  })
})
