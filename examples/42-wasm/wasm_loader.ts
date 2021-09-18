import type { Plugin } from 'aleph/types.d.ts'

export default <Plugin>{
  name: 'json-loader',
  setup: aleph => {
    aleph.onLoad(/\.json$/i, async ({ specifier }) => {
      const { content } = await aleph.fetchModule(specifier)
      return {
        code: `export default = ` + new TextDecoder().decode(content)
      }
    })
  }
}
