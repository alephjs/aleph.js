import { assertEquals, assertThrows } from 'std/testing/asserts.ts'
import { trimModuleExt, toPagePath, importModule } from './module.ts'

// Augment the window object
interface MockWindow extends Window {
    __ALEPH: { import: (src: string, refetch?: boolean) => Promise<string> }
}
declare let window: MockWindow

Deno.test('module toPagePath', () => {
    assertEquals(toPagePath('/pages/bar.ts'), '/bar')
    assertEquals(toPagePath('/foobar/index.ts'), '/foobar')

    assertEquals(toPagePath(''), '/')

    assertThrows(() => toPagePath({} as string))
})

Deno.test('module trimModuleExt', () => {
    assertEquals(trimModuleExt('foobar.ts'), 'foobar')

    assertEquals(trimModuleExt('baz.zip'), 'baz.zip')

    assertEquals(trimModuleExt('barbaz.jsx.ts'), 'barbaz.jsx')

    assertEquals(trimModuleExt('/index.ts'), '/index')

    assertThrows(() => trimModuleExt({} as string))

    assertEquals(trimModuleExt('😀'), '😀')

})

Deno.test('module importModule', async () => {
    // mock  __ALEPH.import
    function foo(str: string, refetch: boolean = false) {
        if (refetch) {
            return Promise.resolve('refetching...')
        }
        return Promise.resolve(str)
    }
    window.__ALEPH = {
        import: foo
    }

    const return1 = await importModule('/foo/bar', 'baz.ts')
    assertEquals(return1, 'baz.ts')

    const return2 = await importModule('/foo/bar', 'baz.ts', true)
    assertEquals(return2, 'refetching...')
})
