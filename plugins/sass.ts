import { Options, Result } from 'https://esm.sh/sass@1.32.8'
import type { LoaderPlugin } from '../types.ts'

let renderSync: null | ((options: Options) => Result) = null

export default (opts?: Options): LoaderPlugin => ({
  name: 'sass-loader',
  type: 'loader',
  test: /\.(sass|scss)$/i,
  acceptHMR: true,
  async transform({ content, url }) {
    if (!('userAgent' in window.navigator)) {
      Object.assign(window.navigator, { userAgent: `Deno/${Deno.version.deno}` })
    }
    if (renderSync === null) {
      const sass = await import('https://esm.sh/sass@1.32.8')
      renderSync = sass.renderSync
    }
    const { css, map } = renderSync({
      indentedSyntax: url.endsWith('.sass'),
      ...opts,
      file: url,
      data: (new TextDecoder).decode(content),
      sourceMap: true
    })
    return {
      code: (new TextDecoder).decode(css),
      type: 'css',
      map: map ? (new TextDecoder).decode(map) : undefined,
    }
  }
})
