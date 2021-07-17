import { join } from 'std/path/mod.ts'
import { assert, assertEquals } from 'std/testing/asserts.ts'
import { Aleph } from '../server/aleph.ts'
import { ensureTextFile } from '../shared/fs.ts'
import { markdownLoader } from './markdown.ts'

Deno.test('plugin: markdown loader', async () => {
  Deno.env.set('DENO_TESTING', 'true')
  const dir = await Deno.makeTempDir({ prefix: 'aleph_plugin_testing' })
  const aleph = new Aleph(dir)
  await ensureTextFile(
    join(dir, '/pages/docs/index.md'),
    [
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
    ].join('\n')
  )
  const { code } = await markdownLoader.load!({ specifier: '/pages/docs/index.md', }, aleph)

  assert(markdownLoader.test.test('/test.md'))
  assert(markdownLoader.test.test('/test.markdown'))
  assert(markdownLoader.allowPage)
  assertEquals(markdownLoader.resolve!('/pages/docs/get-started.md').pagePath, '/docs/get-started')
  assert(!markdownLoader.resolve!('/pages/docs/get-started.md').isIndex)
  assertEquals(markdownLoader.resolve!('/pages/docs/index.md').pagePath, '/docs')
  assert(markdownLoader.resolve!('/pages/docs/index.md').isIndex)
  assert(code.includes('html: "<h1 id=\\"alephjs\\">Aleph.js</h1>\\n<p>The Full-stack Framework in Deno.</p>\\n"'))
  assert(code.includes('MarkdownPage.meta = {"id":"mark-page-1","className":"mark-page","style":{"color":"#333"},"url":"https://alephjs.org"}'))
})
