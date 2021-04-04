import wasm from './wasm_loader.ts'
import type { Config } from '../../types.ts'

export default (): Config => ({
  plugins: [wasm()]
})
