import { assertEquals } from 'https://deno.land/std@0.83.0/testing/asserts.ts'
import plugin from './sass.ts'

Deno.test('project scss loader plugin', async () => {
    const { code } = await plugin.precompile!(
        (new TextEncoder).encode('$someVar: 123px; .some-selector { width: $someVar; }'),
        'test.scss'
    )
    assertEquals(plugin.test.test('test.sass'), true)
    assertEquals(plugin.test.test('test.scss'), true)
    assertEquals(plugin.loader, 'css')
    assertEquals(plugin.acceptHMR, true)
    assertEquals(code, '.some-selector {\n  width: 123px;\n}')
})

Deno.test('project sass loader plugin', async () => {
    let ret = await plugin.precompile!(
        (new TextEncoder).encode('$someVar: 123px\n.some-selector\n  width: 123px'),
        'test.sass'
    )
    assertEquals(ret.code, '.some-selector {\n  width: 123px;\n}')
    ret = await plugin({ indentType: 'tab', indentWidth: 2 }).precompile!(
        (new TextEncoder).encode('$someVar: 123px\n.some-selector\n  width: 123px'),
        'test.sass'
    )
    assertEquals(ret.code, '.some-selector {\n\t\twidth: 123px;\n}')
})
