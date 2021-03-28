import markdown from '../../plugins/markdown.ts'
import type { Config } from '../../types.ts'

export default (): Config => ({
  plugins: [
    markdown(),
  ]
})
