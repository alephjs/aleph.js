import { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts'
import { CSSProcessor } from './css.ts'

Deno.test('css processor', async () => {
  const processor = new CSSProcessor()
  const { code } = await processor.transform(
    '/test.css',
    'h1 { font-size: 18px; }'
  )
  assertEquals(code, 'import { applyCSS } from "https://deno.land/x/aleph/framework/core/style.ts"\napplyCSS("/test.css", "h1 { font-size: 18px; }")')
})

Deno.test('css processor for inline style', async () => {
  const processor = new CSSProcessor()
  const { code } = await processor.transform(
    '#inline-style-{}',
    'h1 { font-size: 18px; }'
  )
  assertEquals(code, 'h1 { font-size: 18px; }')
})

Deno.test('css processor in production mode', async () => {
  const processor = new CSSProcessor()
  processor.config(true, [])
  const { code } = await processor.transform(
    '/test.css',
    'h1 { font-size: 18px; }'
  )

  assertEquals(code, 'import { applyCSS } from "https://deno.land/x/aleph/framework/core/style.ts"\napplyCSS("/test.css", "h1{font-size:18px}")')
})

Deno.test('css processor with postcss plugins', async () => {
  const processor = new CSSProcessor()
  processor.config(false, ['postcss-nested'])
  const { code } = await processor.transform(
    '/test.css',
    '.foo { .bar { font-size: 100%; } }'
  )
  assertEquals(code, 'import { applyCSS } from "https://deno.land/x/aleph/framework/core/style.ts"\napplyCSS("/test.css", ".foo .bar { font-size: 100%; }")')
})
