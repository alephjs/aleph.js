import sassLoader from '../../plugins/sass.ts'
import wasmLoader from '../../plugins/wasm.ts'
import type { Config } from '../../types.ts'

export default (): Config => ({
  plugins: [sassLoader(), wasmLoader()]
})
