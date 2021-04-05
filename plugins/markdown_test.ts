import { assertEquals } from '../deps.test.ts'
import markdownLoader from './markdown.ts'

Deno.test('markdown loader', async () => {
  const loader = markdownLoader()
  const { code } = await loader.transform!({
    url: '/test.md',
    content: (new TextEncoder).encode([
      '---',
      'id: mark-page-1',
      'className: mark-page',
      'style:',
      '  color: "#333"',
      'url: https://alephjs.org',
      '---',
      '',
      '# Aleph.js',
      'The Full-stack Framework in Deno.'
    ].join('\n')),
  })
  assertEquals(loader.test.test('/test.md'), true)
  assertEquals(loader.test.test('/test.markdown'), true)
  assertEquals(loader.allowPage, true)
  assertEquals(loader.pagePathResolve!('/pages/docs/get-started.md'), { path: '/docs/get-started', isIndex: false })
  assertEquals(loader.pagePathResolve!('/pages/docs/index.md'), { path: '/docs', isIndex: true })
  assertEquals(code.includes('html: "<h1 id=\\"alephjs\\">Aleph.js</h1>\\n<p>The Full-stack Framework in Deno.</p>\\n"'), true)
  assertEquals(code.includes('MarkdownPage.meta = {"id":"mark-page-1","className":"mark-page","style":{"color":"#333"},"url":"https://alephjs.org"}'), true)
})
