import type { Config } from '../../types.ts'
import wasm from './wasm_loader.ts'

export default (): Config => ({
  plugins: [wasm()]
})
