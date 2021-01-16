import { assertEquals } from 'https://deno.land/std@0.83.0/testing/asserts.ts';
import plugin from './sass.ts';

Deno.test('project scss loader plugin', () => {
    Object.assign(window, {
        location: {
            href: 'https://localhost/'
        }
    })
    const { code, loader } = plugin.transform(
        (new TextEncoder).encode('$someVar: 123px; .some-selector { width: $someVar; }'),
        'test.scss'
    )
    assertEquals(plugin.test.test('test.sass'), true)
    assertEquals(plugin.test.test('test.scss'), true)
    assertEquals(plugin.acceptHMR, true)
    assertEquals(code, '.some-selector {\n  width: 123px;\n}')
    assertEquals(loader, 'css')
})

Deno.test('project sass loader plugin', () => {
    Object.assign(window, {
        location: {
            href: 'https://localhost/'
        }
    })
    let ret = plugin.transform(
        (new TextEncoder).encode('$someVar: 123px\n.some-selector\n  width: 123px'),
        'test.sass'
    )
    assertEquals(ret.code, '.some-selector {\n  width: 123px;\n}')
    ret = plugin({ indentType: 'tab', indentWidth: 2 }).transform(
        (new TextEncoder).encode('$someVar: 123px\n.some-selector\n  width: 123px'),
        'test.sass'
    )
    assertEquals(ret.code, '.some-selector {\n\t\twidth: 123px;\n}')
})
