import markdown from 'aleph/plugins/markdown.ts'
import type { Config } from 'aleph/types'

export default (): Config => ({
  plugins: [
    markdown(),
  ]
})
