import type { Plugin } from '../types.d.ts'

// todo: remove this plugin when deno support `json` module
// check https://github.com/denoland/deno/issues/7623
export default (): Plugin => {
  return {
    name: 'json-loader',
    setup: aleph => {
      aleph.onLoad(/\.json$/i, async ({ specifier }) => {
        const { content } = await aleph.fetchModule(specifier)
        return {
          code: `export default ` + new TextDecoder().decode(content)
        }
      })
    }
  }
}
