import type { Config } from 'aleph/types'
import wasm from './wasm_loader.ts'

export default (): Config => ({
  plugins: [wasm()]
})
