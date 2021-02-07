import sassLoader from 'aleph/plugins/loader/sass.ts'
import wasmLoader from 'aleph/plugins/loader/wasm.ts'
import type { Config } from 'aleph/types.ts'

export default (): Config => ({
  plugins: [sassLoader(), wasmLoader()]
})
