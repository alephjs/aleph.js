import markdown from '../../plugins/markdown.ts'
import type { Config } from 'aleph/types'

export default (): Config => ({
  plugins: [
    markdown({
      highlight: {
        provider: 'highlight.js',
        theme: 'github'
      }
    }),
  ]
})
