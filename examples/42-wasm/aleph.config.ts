import sass from '../../plugins/sass.ts'
import wasm from '../../plugins/wasm.ts'
import type { Config } from '../../types.ts'

export default (): Config => ({
  plugins: [sass(), wasm()]
})
