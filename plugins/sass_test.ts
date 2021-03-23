import { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts'
import sassLoader from './sass.ts'

Deno.test('scss loader', async () => {
  const loader = sassLoader()
  const { code, type } = await loader.transform({
    url: '/test.scss',
    content: (new TextEncoder).encode('$someVar: 123px; .some-selector { width: $someVar; }'),
  })
  assertEquals(loader.test.test('/test.scss'), true)
  assertEquals(loader.acceptHMR, true)
  assertEquals(type, 'css')
  assertEquals(code, '.some-selector {\n  width: 123px;\n}')
})

Deno.test('sass loader', async () => {
  const loader = sassLoader()
  const { code, type } = await loader.transform({
    url: '/test.sass',
    content: (new TextEncoder).encode('$someVar: 123px\n.some-selector\n  width: 123px'),
  })
  assertEquals(loader.test.test('/test.sass'), true)
  assertEquals(loader.acceptHMR, true)
  assertEquals(type, 'css')
  assertEquals(code, '.some-selector {\n  width: 123px;\n}')
})

Deno.test('sass loader with options', async () => {
  const loader = sassLoader({ indentType: 'tab', indentWidth: 2 })
  const { code, type } = await loader.transform({
    url: '/test.sass',
    content: (new TextEncoder).encode('$someVar: 123px\n.some-selector\n  width: 123px'),
  })
  assertEquals(loader.test.test('/test.sass'), true)
  assertEquals(loader.acceptHMR, true)
  assertEquals(type, 'css')
  assertEquals(code, '.some-selector {\n\t\twidth: 123px;\n}')
})
