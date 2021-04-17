/**
 * NOTE: This test needs the --location cli flag set
 * see https://github.com/denoland/deno/blob/main/docs/runtime/location_api.md
 * and explanation below.
 */
import { assertEquals } from 'std/testing/asserts.ts'
import { redirect } from './redirect.ts'

// mock history functions used in redirect()
interface MockWindow extends Window {
    history: {
        replaceState: (state: object | null, title: string | '', url?: string) => void,
        pushState: (state: object | null, title: string | '', url?: string) => void
    }
}
declare let window: MockWindow

// track calls to history functions
const calls = {
    pushCalls: 0, // tracks calls to pushState()
    replaceCalls: 0 // tracks calls to replaceState()
}
// create mock history impl
window.history = {
    replaceState: (url) => { calls.replaceCalls++; return null },
    pushState: (url) => { calls.pushCalls++; return null }
}

const resetCallCount = () => {
    calls.pushCalls = 0
    calls.replaceCalls = 0
}

Deno.test('redirect: replace=false should call history.pushState', () => {
    const url = '/foo/bar.ts'

    redirect(url)
    assertEquals(calls.pushCalls, 1)
    redirect(url)
    assertEquals(calls.pushCalls, 2)
    redirect(url)
    assertEquals(calls.pushCalls, 3)

    resetCallCount()
})

Deno.test('redirect: replace=true should call history.replaceState', () => {
    const url = '/foo/bar2.ts'

    redirect(url, true)
    assertEquals(calls.replaceCalls, 1)
    redirect(url, true)

    assertEquals(calls.replaceCalls, 2)

    resetCallCount()
})

Deno.test('redirect: empty string url should not call history methods', () => {
    const url = ''

    redirect(url)

    assertEquals(calls.pushCalls, 0)
    assertEquals(calls.replaceCalls, 0)

})

/**
 * This fails because setting location.href is not allowed in a
 * non-browser environment. see
 * https://github.com/denoland/deno/blob/main/docs/runtime/location_api.md
 * This errors out on line 12 of redirect().
 */
// Deno.test('redirect: file url should set location.href', () => {
//     const url = 'file://foo/file.ts'

//     redirect(url)

//     assertEquals(window.location.href, url)
//     assertEquals(calls.pushCalls, 0)
//     assertEquals(calls.replaceCalls, 0)

//     resetCallCount()
// })
