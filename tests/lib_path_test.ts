import { assertEquals } from 'std/testing/asserts.ts'
import util from '../lib/util.ts'
import {
  toRelativePath,
  toLocalPath
} from '../lib/path.ts'

Deno.test('server/helper: toRelativePath', () => {
  assertEquals(toRelativePath('/baz/foobar', '/baz/aleph'), '../aleph')
  assertEquals(toRelativePath('baz/foobar', 'baz/aleph'), '../aleph')
  assertEquals(toRelativePath('baz/foobar', 'baz/foobar/aleph'), './aleph')
})

Deno.test('server/helper: toLocalPath', () => {
  assertEquals(toLocalPath('https://foo.com/lib@0.1.0?action'), `/-/foo.com/lib@0.1.0.${util.btoaUrl('action')}.js`)
  assertEquals(toLocalPath('https://deno.land/x/aleph@v0.3.0-alpha.29/'), '/-/deno.land/x/aleph@v0.3.0-alpha.29/')
  assertEquals(toLocalPath('http://foo.com/bar?lang=us-en'), `/-/http_foo.com/bar.${util.btoaUrl('lang=us-en')}.js`)
  assertEquals(toLocalPath('http://foo.com:8080/bar'), '/-/http_foo.com_8080/bar')
  assertEquals(toLocalPath('file://foo/bar/'), 'foo/bar/')
  assertEquals(toLocalPath('/foo/bar/'), '/foo/bar/')
})
