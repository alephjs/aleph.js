import { join } from 'std/path/mod.ts'
import { assertEquals } from 'std/testing/asserts.ts'
import { Aleph } from '../server/aleph.ts'
import { ensureTextFile } from '../shared/fs.ts'
import { cssLoader } from './css.ts'

Deno.test('plugin: css loader', async () => {
  Deno.env.set('DENO_TESTING', 'true')
  const dir = await Deno.makeTempDir({ prefix: 'aleph_plugin_testing' })
  const aleph = new Aleph(dir, 'development')
  await ensureTextFile(
    join(dir, '/style/index.css'),
    'h1 { font-size: 18px; }'
  )
  const { code } = await cssLoader({ specifier: '/style/index.css', }, aleph)
  assertEquals(code, [
    'import { applyCSS } from "https://deno.land/x/aleph/framework/core/style.ts"',
    'export const css = "h1 { font-size: 18px; }"',
    'export default {}',
    'applyCSS("/style/index.css", { css })',
  ].join('\n'))
})

Deno.test('plugin: css loader for remote external', async () => {
  Deno.env.set('DENO_TESTING', 'true')
  const dir = await Deno.makeTempDir({ prefix: 'aleph_plugin_testing' })
  const aleph = new Aleph(dir, 'development')
  aleph.config.css.cache = false
  const { code } = await cssLoader({ specifier: 'https://esm.sh/tailwindcss/dist/tailwind.min.css', }, aleph)
  assertEquals(code, [
    'import { applyCSS } from "https://deno.land/x/aleph/framework/core/style.ts"',
    'export const href = "https://esm.sh/tailwindcss/dist/tailwind.min.css"',
    'export default {}',
    'applyCSS("https://esm.sh/tailwindcss/dist/tailwind.min.css", { href })',
  ].join('\n'))
})

Deno.test('plugin: css loader for inline styles', async () => {
  Deno.env.set('DENO_TESTING', 'true')
  const dir = await Deno.makeTempDir({ prefix: 'aleph_plugin_testing' })
  const aleph = new Aleph(dir, 'development')
  const { code, type } = await cssLoader({
    specifier: '#inline-style-{}',
    data: 'h1 { font-size: 18px; }'
  }, aleph)
  assertEquals(code, 'h1 { font-size: 18px; }')
  assertEquals(type, 'css')
})

Deno.test({
  name: 'plugin: css loader css modules feature',
  fn: async () => {
    Deno.env.set('DENO_TESTING', 'true')
    const dir = await Deno.makeTempDir({ prefix: 'aleph_plugin_testing' })
    const aleph = new Aleph(dir, 'development')
    aleph.config.css.modules = {
      scopeBehaviour: 'local',
      generateScopedName: '[name]_[local]'
    }
    await ensureTextFile(
      join(dir, '/style/index.module.css'),
      '.name { font-size: 18px; }'
    )
    const { code } = await cssLoader({ specifier: '/style/index.module.css', }, aleph)
    assertEquals(code, [
      'import { applyCSS } from "https://deno.land/x/aleph/framework/core/style.ts"',
      'export const css = ".index-module_name { font-size: 18px; }"',
      'export default {"name":"index-module_name"}',
      'applyCSS("/style/index.module.css", { css })',
    ].join('\n'))
  },
  sanitizeResources: false
})

Deno.test('plugin: css loader with postcss plugins', async () => {
  Deno.env.set('DENO_TESTING', 'true')
  const dir = await Deno.makeTempDir({ prefix: 'aleph_plugin_testing' })
  const aleph = new Aleph(dir, 'development')
  aleph.config.css.postcss = {
    plugins: ['postcss-nested']
  }
  await ensureTextFile(
    join(dir, '/style/index.css'),
    '.foo { .bar { font-size: 100%; } }'
  )
  const { code } = await cssLoader({ specifier: '/style/index.css' }, aleph)
  assertEquals(code, [
    'import { applyCSS } from "https://deno.land/x/aleph/framework/core/style.ts"',
    'export const css = ".foo .bar { font-size: 100%; }"',
    'export default {}',
    'applyCSS("/style/index.css", { css })',
  ].join('\n'))
})
