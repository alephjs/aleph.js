import css from 'aleph/plugins/css.ts'
import type { Config } from 'aleph/types.ts'

export default (): Config => ({
  plugins: [
    css({
      postcss: { plugins: ['autoprefixer'] }
    })
  ]
})
