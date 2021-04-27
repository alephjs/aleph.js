import {
  assert,
  assertEquals,
  assertThrows,
  assertNotEquals
} from 'std/testing/asserts.ts'
import { SEP } from 'std/path/separator.ts'
import {
  existsDirSync,
  existsFileSync,
  ensureTextFile,
  lazyRemove
} from './fs.ts'

Deno.test(`fs: existsDirSync`, () => {
  // true test cases
  const dir = Deno.makeTempDirSync()
  assert(existsDirSync(dir))
  assert(existsDirSync(Deno.realPathSync(getStandardFolder())))
  // false test cases
  assertEquals(existsDirSync(`${dir}${SEP}foobar`), false)
  const file = Deno.makeTempFileSync()
  assertEquals(existsDirSync(file), false)
  // error test cases
  assertThrows(() => existsDirSync({} as string), Error)
})



Deno.test(`fs: existsFileSync`, () => {
  // true test cases
  const file = Deno.makeTempFileSync()
  assert(existsFileSync(file))
  // false test cases
  const dir = Deno.makeTempDirSync()
  assert(!existsFileSync(`${dir}`))
  assert(!existsFileSync(`${dir}${SEP}llksdafzxc.ts`))
  // error test cases
  assertThrows(() => existsDirSync({} as string), Error)
})


Deno.test('fs: ensureTextFile', async () => {
  // true test case
  const dirPath = await Deno.makeTempDir()
  const textFilePath = `${dirPath}${SEP}test.txt`
  const content = 'This is a test'
  await ensureTextFile(textFilePath, content)
  assert(existsFileSync(textFilePath))
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
  assertEquals(existsFileSync(filePath), false)
  // false test case
  const dirPath = await Deno.makeTempDir()
  await lazyRemove(`${dirPath}${SEP}asdfsdf.txt`)
  assert(existsDirSync(dirPath))
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
