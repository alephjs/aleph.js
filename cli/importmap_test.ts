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
import { join, dirname, fromFileUrl } from 'https://deno.land/std@0.96.0/path/mod.ts'
import log from '../shared/log.ts'

log.setLevel('error')

type CmdTest = {
  testname: string,
  args: any,
  input: im.ImportMap,
  output: im.ImportMap,
  result: im.CommandResult
}

const addTests = readTests('add')

for (const tc of addTests) {
  Deno.test(`Test Add: ${tc.testname}`, async () => {
    assertEquals(await im.add(tc.input, tc.args[0], tc.args[1], tc.args[2], tc.args[3]), tc.result)
    assertEquals(tc.input, tc.output)
  })
}

const removeTests = readTests('remove')

for (const tc of removeTests) {
  Deno.test(`Test Remove: ${tc.testname}`, async () => {
    assertEquals(await im.remove(tc.input, tc.args[0]), tc.result)
    assertEquals(tc.input, tc.output)
  })
}

/**
 * These tests will fail the moment the packages used to test them update.
 * So they are commented out.
 */
/*
const updateTests = readTests('update')

for (const tc of updateTests) {
  Deno.test(`Test Update: ${tc.testname}`, async () => {
    assertEquals(await im.update(tc.input, tc.args), tc.result)
    assertEquals(tc.input, tc.output)
  })
}
*/

function readTests(folderName: string) {
  const folderPath = join(fromFileUrl(dirname(import.meta.url)), `/importmap_tests/${folderName}/`)
  const folder = Deno.readDirSync(folderPath)
  const tests = []
  for (const t of folder) {
    if (t.isFile) {
      const text = JSON.parse(Deno.readTextFileSync(join(folderPath, t.name))) as CmdTest
      tests.push(text)
    }
  }
  return tests
}
