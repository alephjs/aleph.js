import css from '../../plugins/css.ts'
import type { Config } from '../../types.ts'

export default (): Config => ({
  plugins: [
    css({
      postcss: { plugins: ['autoprefixer'] }
    })
  ]
})
