import { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts'
import markdownLoader from './markdown.ts'

Deno.test('markdown loader', async () => {
  const loader = markdownLoader()
  const { code } = await loader.transform!({
    url: '/test.md',
    content: (new TextEncoder).encode([
      '---',
      'url: https://alephjs.org',
      '---',
      '',
      '# Aleph.js',
      'The Full-stack Framework in Deno.'
    ].join('\n')),
  })
  assertEquals(loader.test.test('/test.md'), true)
  assertEquals(loader.test.test('/test.markdown'), true)
  assertEquals(loader.acceptHMR, true)
  assertEquals(loader.asPage, true)
  assertEquals(loader.pagePathResolve!('/pages/docs/get-started.md'), { path: '/docs/get-started', isIndex: false })
  assertEquals(loader.pagePathResolve!('/pages/docs/index.md'), { path: '/docs', isIndex: true })
  assertEquals(code.includes('{ __html: "<h1 id=\\"alephjs\\">Aleph.js</h1>\\n<p>The Full-stack Framework in Deno.</p>\\n" }'), true)
  assertEquals(code.includes('MarkdownPage.meta = {\n  "url": "https://alephjs.org"\n}'), true)
})


