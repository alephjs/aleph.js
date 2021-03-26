import css from '../../plugins/css.ts'
import markdown from '../../plugins/markdown.ts'
import type { Config } from '../../types.ts'

export default (): Config => ({
  plugins: [
    css({
      postcss: { plugins: ['autoprefixer'] }
    }),
    markdown(),
  ]
})
