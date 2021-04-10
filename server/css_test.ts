import { assertEquals } from 'std/testing/asserts.ts'
import { CSSProcessor } from './css.ts'

Deno.test('css processor', async () => {
  const processor = new CSSProcessor()
  const { code } = await processor.transform(
    '/test.css',
    'h1 { font-size: 18px; }'
  )
  assertEquals(code, [
    'import { applyCSS } from "https://deno.land/x/aleph/framework/core/style.ts"',
    'const css = "h1 { font-size: 18px; }"',
    'applyCSS("/test.css", css)',
    'export default { __url$: "/test.css", __css$: css, }'
  ].join('\n'))
})

Deno.test('css processor in production mode', async () => {
  const processor = new CSSProcessor()
  processor.config(true, { modules: false, postcss: { plugins: [] } })
  const { code } = await processor.transform(
    '/test.css',
    'h1 { font-size: 18px; }'
  )

  assertEquals(code, [
    'import { applyCSS } from "https://deno.land/x/aleph/framework/core/style.ts"',
    'const css = "h1{font-size:18px}"',
    'applyCSS("/test.css", css)',
    'export default { __url$: "/test.css", __css$: css, }'
  ].join('\n'))
})

Deno.test('css processor of remote CSS', async () => {
  const processor = new CSSProcessor()
  processor.config(true, { modules: false, postcss: { plugins: [] } })
  const { code } = await processor.transform(
    'https://esm.sh/tailwindcss/dist/tailwind.min.css',
    ''
  )

  assertEquals(code, [
    'import { applyCSS } from "https://deno.land/x/aleph/framework/core/style.ts"',
    'applyCSS("https://esm.sh/tailwindcss/dist/tailwind.min.css")',
    'export default { __url$: "https://esm.sh/tailwindcss/dist/tailwind.min.css" }'
  ].join('\n'))
})

Deno.test('css processor enables module feature', async () => {
  const processor = new CSSProcessor()
  processor.config(false, {
    modules: {
      scopeBehaviour: 'local',
      generateScopedName: '[name]_[local]'
    }, postcss: { plugins: [] }
  })
  const { code } = await processor.transform(
    '/test.css',
    '.name { font-size: 18px; }'
  )

  assertEquals(code, [
    'import { applyCSS } from "https://deno.land/x/aleph/framework/core/style.ts"',
    'const css = ".test_name { font-size: 18px; }"',
    'applyCSS("/test.css", css)',
    'export default { __url$: "/test.css", __css$: css, "name":"test_name"}'
  ].join('\n'))
})

Deno.test('css processor for inline style', async () => {
  const processor = new CSSProcessor()
  const { code } = await processor.transform(
    '#inline-style-{}',
    'h1 { font-size: 18px; }'
  )
  assertEquals(code, 'h1 { font-size: 18px; }')
})

Deno.test('css processor with postcss plugins', async () => {
  const processor = new CSSProcessor()
  processor.config(false, { modules: false, postcss: { plugins: ['postcss-nested'] } })
  const { code } = await processor.transform(
    '/test.css',
    '.foo { .bar { font-size: 100%; } }'
  )

  assertEquals(code, [
    'import { applyCSS } from "https://deno.land/x/aleph/framework/core/style.ts"',
    'const css = ".foo .bar { font-size: 100%; }"',
    'applyCSS("/test.css", css)',
    'export default { __url$: "/test.css", __css$: css, }'
  ].join('\n'))
})
