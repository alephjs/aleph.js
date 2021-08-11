/**
 * Fragile tests for fragile importmap.ts
 * Tests may fail if a CDN is unreachable
 *
 * Specification for aleph importmap.
 *
 * Examples:
 *
 * -a MODULE -> https://deno.land/x/MODULE@LATEST/mod.ts
 * -a MODULE@VERSION -> https://deno.land/x/MODULE@VERSION/mod.ts
 * -a MODULE/ -> https://deno.land/x/MODULE@LATEST/
 * -a MODULE@VERSION/ -> https://deno.land/x/MODULE@VERSION/
 * -a MODULE/FILE.ts -> https://deno.land/x/MODULE@LATEST/FILE.ts
 * -a MODULE@VERSION/FILE.ts -> https://deno.land/x/MODULE@VERSION/FILE.ts
 *
 *
 *
 */
import * as im from './importmap.ts'
import {
  assertEquals,
  assertMatch
} from 'https://deno.land/std@0.96.0/testing/asserts.ts'

/** Test stripping version numbers from module name */
namespace stripVerTest {
  const cases = {
    'aleph/': 'aleph/',
    'std/hash/': 'std/hash/',
    'std@1.3.1/': 'std/',
    'std@5.2/path/': 'std/path/',
    'aleph@v1.0.0/': 'aleph/',
    'react@17.1.3/': 'react/',
    'package@a123.1sz/abc.ts': 'package/abc.ts',
  }
  for (const c of Object.keys(cases)) {
    Deno.test(`stripVer(${c})`, () => {
      assertEquals(im.stripVer(c), cases[c as keyof typeof cases])
    })
  }
}

namespace getSubModTest {
  const cases = {
    'aleph/': '',
    'std/hash/': '/hash',
    'std@1.3.1/': '',
    'std@5.2/path/': '/path',
    'aleph@v1.0.0/': '',
    'react@17.1.3/': '',
    'package@a123.1sz/abc.ts': '/abc.ts',
  }
  for (const c of Object.keys(cases)) {
    Deno.test(`getSubMod(${c})`, () => {
      assertEquals(im.getSubMod(c), cases[c as keyof typeof cases])
    })
  }
}

namespace getSTDUrlTest {
  const cases = {
    'std/': /https:\/\/deno\.land\/std@\d+\.\d+\.\d+\//,
    'std@0.96.0/': 'https://deno.land/std@0.96.0/',
    'std@0.96.0/path': 'https://deno.land/std@0.96.0/path/mod.ts',
    'std@0.42.0/fs': 'https://deno.land/std@0.42.0/fs/mod.ts',
    'std@0.42.0/fs/': 'https://deno.land/std@0.42.0/fs/',
    'std@0.42.0/fs/ensure_link.ts': 'https://deno.land/std@0.42.0/fs/ensure_link.ts',
    'std@0.42.0/fs/testdata/': 'https://deno.land/std@0.42.0/fs/testdata/',
  }
  for (const c of Object.keys(cases)) {
    Deno.test(`getSTDUrl(${c})`, async () => {
      const ca = cases[c as keyof typeof cases]
      if (typeof ca === 'string') {
        assertEquals(await im.getSTDUrl(c), ca)
      } else {
        assertMatch(await im.getSTDUrl(c), ca)
      }
    })
  }
}

namespace getXUrlTest {
  const cases = {
    'aleph/': /https:\/\/deno\.land\/x\/aleph@[^/]+\//,
    'aleph/framework/': /https:\/\/deno\.land\/x\/aleph@[^/]+\/framework\//,
    'aleph@v0.3.0-alpha.33/': 'https://deno.land/x/aleph@v0.3.0-alpha.33/',
    'aleph@v0.3.0-alpha.33/framework/core': 'https://deno.land/x/aleph@v0.3.0-alpha.33/framework/core/mod.ts',
  }
  for (const c of Object.keys(cases)) {
    Deno.test(`getXUrl(${c})`, async () => {
      const ca = cases[c as keyof typeof cases]
      if (typeof ca === 'string') {
        assertEquals(await im.getXUrl(c), ca)
      } else {
        assertMatch(await im.getXUrl(c), ca)
      }
    })
  }
}

