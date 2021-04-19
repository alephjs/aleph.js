/**
 * NOTE: This test needs the --location cli flag set
 * see https://github.com/denoland/deno/blob/main/docs/runtime/location_api.md
 * and explanation below.
 */

import { assertEquals } from 'std/testing/asserts.ts'
import events from './events.ts'
import { redirect } from './redirect.ts'

// mock history functions used in redirect()
Object.assign(window, {
  history: {
    replaceState: (url: string) => { stacks.replaceCalls++ },
    pushState: (url: string) => { stacks.pushCalls++ }
  }
})

// track calls to history functions
const stacks = {
  pushCalls: 0, // tracks calls to pushState()
  replaceCalls: 0 // tracks calls to replaceState()
}

const resetStacks = () => {
  stacks.pushCalls = 0
  stacks.replaceCalls = 0
}

Deno.test('fw/core/redirect: replace=false should call history.pushState', () => {
  const url = '/foo/bar'

  redirect(url)
  assertEquals(stacks.pushCalls, 1)
  redirect(url)
  assertEquals(stacks.pushCalls, 2)
  redirect(url)
  assertEquals(stacks.pushCalls, 3)

  resetStacks()
})

Deno.test('fw/core/redirect: replace=true should call history.replaceState', () => {
  const url = '/foo/bar'

  redirect(url, true)
  assertEquals(stacks.replaceCalls, 1)
  redirect(url, true)
  assertEquals(stacks.replaceCalls, 2)


  resetStacks()
})

Deno.test('fw/core/redirect: empty string url should not call history methods', () => {
  redirect('')

  assertEquals(stacks.pushCalls, 0)
  assertEquals(stacks.replaceCalls, 0)
})

Deno.test('fw/core/redirect: pre-redirect should emit "popstate" event deferredly', () => {
  let popstate: any = null

  redirect('/foo/bar', true)

  events.on('popstate', (e) => { popstate = e })
  assertEquals(popstate, null)

  events.emit('routerstate', { ready: true })
  assertEquals(popstate, { type: 'popstate', resetScroll: true })
  assertEquals(stacks.pushCalls, 0)
  assertEquals(stacks.replaceCalls, 1)

  resetStacks()
})

/**
 * This fails because setting location.href is not allowed in a
 * non-browser environment. see
 * https://github.com/denoland/deno/blob/main/docs/runtime/location_api.md
 * This errors out on line 12 of redirect().
 */
// Deno.test('fw/core/redirect: file url should set location.href', () => {
//     const url = 'file://foo/file.ts'

//     redirect(url)

//     assertEquals(window.location.href, url)
//     assertEquals(calls.pushCalls, 0)
//     assertEquals(calls.replaceCalls, 0)

//     resetStacks()
// })
