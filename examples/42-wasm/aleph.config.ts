import css from 'aleph/plugins/css.ts'
import sass from 'aleph/plugins/sass.ts'
import wasm from 'aleph/plugins/wasm.ts'
import type { Config } from 'aleph/types.ts'

export default (): Config => ({
  plugins: [css(), sass(), wasm()]
})
