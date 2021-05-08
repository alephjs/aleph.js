import {
  assert,
  assertEquals,
  assertNotEquals
} from 'std/testing/asserts.ts'
import { SEP } from 'std/path/separator.ts'
import {
  existsDir,
  existsFile,
  ensureTextFile,
  lazyRemove
} from './fs.ts'

Deno.test(`fs: existsDir`, async () => {
  // true test cases
  const dir = await Deno.makeTempDir()
  assert(await existsDir(dir))
  assert(await existsDir(await Deno.realPath(getStandardFolder())))
  // false test cases
  const file = await Deno.makeTempFile()
  assertEquals(await existsDir(file), false)
  assertEquals(await existsDir(`${dir}${SEP}foo${SEP}bar`), false)
})

Deno.test(`fs: existsFile`, async () => {
  // true test cases
  const file = await Deno.makeTempFile()
  assert(await existsFile(file))
  // false test cases
  const dir = await Deno.makeTempDir()
  assert(!await existsFile(`${dir}`))
  assert(!await existsFile(`${dir}${SEP}foo${SEP}bar`))
})

Deno.test('fs: ensureTextFile', async () => {
  // true test case
  const dirPath = await Deno.makeTempDir()
  const textFilePath = `${dirPath}${SEP}test.txt`
  const content = 'This is a test'
  await ensureTextFile(textFilePath, content)
  assert(await existsFile(textFilePath))
  const testContent = await Deno.readTextFile(textFilePath)
  assertEquals(testContent, content)
  // false test case
  // illegal folder name
  const textFilePath2 = `${SEP}test2.txt`
  let testContent2 = ''
  try {
    await ensureTextFile(textFilePath2, content)
    testContent2 = await Deno.readTextFile(textFilePath2)
  } catch (error) {
    assertNotEquals(testContent2, content)
  }
})

Deno.test('fs: lazyRemove', async () => {
  // true test case
  const filePath = await Deno.makeTempFile()
  await lazyRemove(filePath)
  assertEquals(await existsFile(filePath), false)
  // false test case
  const dirPath = await Deno.makeTempDir()
  await lazyRemove(`${dirPath}${SEP}foo${SEP}bar.bin`)
  assert(await existsDir(dirPath))
})

/**
 * Returns an operating system-specific
 * example folder.
 * @returns 'C:\Windows' for Windows or
 *  '/tmp' for unix-based operating systems
 */
const getStandardFolder = () => {
  return Deno.build.os === 'windows' ? "C:\\Windows" : '/tmp'
}
