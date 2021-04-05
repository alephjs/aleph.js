import {
    assert, assertEquals, assertThrows, assertNotEquals
} from '../deps.test.ts'
import { SEP } from '../deps.test.ts'
import {
    existsDir, existsDirSync, existsFile, existsFileSync,
    ensureTextFile, lazyRemove
} from './fs.ts'


Deno.test(`fs existsDirSync`, () => {
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


Deno.test(`fs async existsDir`, async () => {
    // true test cases
    assert(await existsDir(await Deno.realPath(getStandardFolder())))
    const dir = await Deno.makeTempDir()
    assertEquals(await existsDir(dir), true)
    // false test cases
    assertEquals(await existsDir(`${dir}${SEP}foobar`), false)
    const file = await Deno.makeTempFile()
    assertEquals(await existsDir(file), false)
    // error test cases
    existsDir({} as string).then(err => {
        assert(err instanceof Error)
    }).catch(e => console.error(e))
})

Deno.test(`fs existsFileSync`, () => {
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

Deno.test(`fs async existsFile`, async () => {
    // true test cases
    const file = await Deno.makeTempFile()
    assert(await existsFile(file))
    // false test cases
    const dir = Deno.makeTempDirSync()
    assertEquals(await existsFile(dir), false)
    assertEquals(await existsFileSync(`${dir}${SEP}llksdafzxc.ts`), false)
    // error test cases
    existsFile({} as string).then(err => {
        assert(err instanceof Error)
    }).catch(e => console.error(e))
})

Deno.test('ensureTextFile', async () => {
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

Deno.test('lazyRemove', async () => {
    // true test case
    const filePath = await Deno.makeTempFile()
    await lazyRemove(filePath)
    assertEquals(existsFileSync(filePath), false)
    // false test case
    const dirPath = await Deno.makeTempDir()
    await lazyRemove(`${dirPath}${SEP}asdfsdf.txt`)
    assert(await existsDir(dirPath))
    // error test
    lazyRemove({} as string).then(err => {
        assert(err instanceof Error)
    }).catch(e => console.error(e))

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
