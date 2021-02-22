import { Options, renderSync } from 'https://esm.sh/sass@1.32.5'
import type { LoaderPlugin } from '../types.ts'

export default (opts?: Options): LoaderPlugin => ({
  name: 'sass-loader',
  type: 'loader',
  test: /\.(sass|scss)$/i,
  acceptHMR: true,
  async transform({ content, url }) {
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
