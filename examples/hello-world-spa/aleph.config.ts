import css from '../../plugins/css.ts'
import type { Config } from '../../types.ts'

export default (): Config => ({
  ssr: false,
  plugins: [
    css({
      postcss: { plugins: ['autoprefixer'] }
    })
  ]
})
