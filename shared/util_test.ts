import { assertEquals } from 'https://deno.land/std@0.88.0/testing/asserts.ts'
import { delay } from 'https://deno.land/std@0.88.0/async/delay.ts'
import util from './util.ts'

Deno.test(`util`, async () => {
  assertEquals(util.inDeno(), true)

  // test util.isLikelyHttpURL()
  {
    assertEquals(util.isLikelyHttpURL('https://deno.land'), true)
    assertEquals(util.isLikelyHttpURL('http://deno.land'), true)
    assertEquals(util.isLikelyHttpURL('//deno.land'), false)
    assertEquals(util.isLikelyHttpURL('file:///deno.land'), false)
    assertEquals(util.isLikelyHttpURL('www.deno.land'), false)
  }

  // test util.trimPrefix()
  {

    assertEquals(util.trimPrefix('foobar', 'foo'), 'bar')
    assertEquals(util.trimPrefix('foobar', 'baz'), 'foobar')
    assertEquals(util.trimSuffix('foobar', 'bar'), 'foo')
    assertEquals(util.trimSuffix('foobar', 'baz'), 'foobar')
  }

  // test util.splitBy()
  {
    assertEquals(util.splitBy('/app.tsx', '.'), ['/app', 'tsx'])
    assertEquals(util.splitBy('foo.bar.', '.'), ['foo', 'bar.'])
    assertEquals(util.splitBy('foobar.', '.'), ['foobar', ''])
    assertEquals(util.splitBy('.foobar.', '.'), ['', 'foobar.'])
    assertEquals(util.splitBy('foobar', '.'), ['foobar', ''])
  }

  // test util.splitBy()
  {
    assertEquals(util.formatBytes(100), '100B')
    assertEquals(util.formatBytes(1024 ** 1), '1KB')
    assertEquals(util.formatBytes(1024 ** 2), '1MB')
    assertEquals(util.formatBytes(1024 ** 3), '1GB')
    assertEquals(util.formatBytes(1024 ** 4), '1TB')
    assertEquals(util.formatBytes(1024 ** 5), '1PB')
  }

  // test util.cleanPath(()
  {
    assertEquals(util.cleanPath('./'), '/')
    assertEquals(util.cleanPath('./a/./b/./c/.'), '/a/b/c')
    assertEquals(util.cleanPath('../'), '/')
    assertEquals(util.cleanPath('../a/b/c'), '/a/b/c')
    assertEquals(util.cleanPath('/a/../b/c'), '/b/c')
    assertEquals(util.cleanPath('/a/b/../c'), '/a/c')
    assertEquals(util.cleanPath('\\a\\b\\c'), '/a/b/c')
    assertEquals(util.cleanPath('\\a\\b\\.\\..\\c'), '/a/c')
    assertEquals(util.cleanPath('//a//b//c//'), '/a/b/c')
  }

  // test util.debounce()
  {
    let n = 0
    const plus = util.debounce(() => n++, 50)
    plus()
    assertEquals(n, 0)
    await delay(75)
    assertEquals(n, 1)
    plus()
    plus()
    plus()
    assertEquals(n, 1)
    await delay(75)
    assertEquals(n, 2)
  }

  // test util.debounceX()
  {
    let n = 0
    util.debounceX('test', () => n++, 50)
    assertEquals(n, 0)
    await delay(75)
    assertEquals(n, 1)
    util.debounceX('test', () => n += 1, 50)
    util.debounceX('test', () => n += 2, 50)
    util.debounceX('test', () => n += 3, 50)
    assertEquals(n, 1)
    await delay(75)
    assertEquals(n, 4)
  }
})
