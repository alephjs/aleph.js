import type { Config } from 'aleph/types'
import wasmLoader from './wasm_loader.ts'

export default <Config>{
  plugins: [wasmLoader]
}
