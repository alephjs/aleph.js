import { Options, Result } from 'https://esm.sh/sass@1.32.8'
import type { LoaderPlugin } from '../types.ts'

type Sass = { renderSync(options: Options): Result }

const decoder = new TextDecoder()

export default (opts?: Options): LoaderPlugin => {
  let sass: Sass | null = null

  return {
    name: 'sass-loader',
    type: 'loader',
    test: /\.(sass|scss)$/i,
    acceptHMR: true,
    async transform({ content, url }) {
      if (!('userAgent' in window.navigator)) {
        Object.assign(window.navigator, { userAgent: `Deno/${Deno.version.deno}` })
      }
      if (sass === null) {
        const { default: SASS } = await import('https://esm.sh/sass@1.32.8')
        sass = SASS
      }
      const { css, map } = sass.renderSync({
        indentedSyntax: url.endsWith('.sass'),
        ...opts,
        file: url,
        data: decoder.decode(content),
        sourceMap: true
      })
      return {
        code: decoder.decode(css),
        type: 'css',
        map: map ? decoder.decode(map) : undefined,
      }
    }
  }
}
