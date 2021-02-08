import sassLoader from 'aleph/plugins/sass.ts'
import wasmLoader from 'aleph/plugins/wasm.ts'
import type { Config } from 'aleph/types.ts'

export default (): Config => ({
  plugins: [sassLoader(), wasmLoader()]
})
