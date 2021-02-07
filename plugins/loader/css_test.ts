import { assertEquals } from 'https://deno.land/std@0.86.0/testing/asserts.ts'
import cssLoader from './css.ts'

Deno.test('css loader', async () => {
  const loader = cssLoader()
  const { code } = await loader.transform({
    url: '/test.css',
    content: (new TextEncoder).encode('h1 { font-size: 18px; }'),
  })
  assertEquals(loader.test.test('/test.css'), true)
  assertEquals(loader.test.test('/test.pcss'), true)
  assertEquals(loader.acceptHMR, true)
  assertEquals(code, 'import { applyCSS } from "https://deno.land/framework/core/style.ts"\napplyCSS("/test.css", "h1 { font-size: 18px; }")')
})

Deno.test('css loader in bundle mode', async () => {
  const loader = cssLoader()
  const { code } = await loader.transform({
    url: '/test.css',
    content: (new TextEncoder).encode('h1 { font-size: 18px; }'),
    bundleMode: true,
  })
  assertEquals(code, 'import { applyCSS } from "https://deno.land/framework/core/style.ts"\n__ALEPH.pack["/test.css"] = { default: () => applyCSS("/test.css", "h1 { font-size: 18px; }") }')
})

Deno.test('css loader in production mode', async () => {
  Deno.env.set('BUILD_MODE', 'production')

  const loader = cssLoader()
  const { code } = await loader.transform({
    url: '/test.css',
    content: (new TextEncoder).encode('h1 { font-size: 18px; }'),
  })
  assertEquals(code, 'import { applyCSS } from "https://deno.land/framework/core/style.ts"\napplyCSS("/test.css", "h1{font-size:18px}")')

  Deno.env.delete('BUILD_MODE')
})

Deno.test('css loader with postcss plugins', async () => {
  const loader = cssLoader({ postcss: { plugins: ['autoprefixer'] } })
  await loader.init!()
  const { code } = await loader.transform({
    url: '/test.css',
    content: (new TextEncoder).encode('.pic { user-select: none; }'),
  })
  assertEquals(code, 'import { applyCSS } from "https://deno.land/framework/core/style.ts"\napplyCSS("/test.css", ".pic { -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none; user-select: none; }")')
})
