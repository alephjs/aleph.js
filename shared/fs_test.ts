import {
    assert, assertEquals, assertThrows,
    assertExists, assertNotEquals
} from 'https://deno.land/std@0.90.0/testing/asserts.ts'
import { SEP } from "https://deno.land/std@0.90.0/path/separator.ts"
import {
    existsDir, existsDirSync, existsFile, existsFileSync,
    ensureTextFile, lazyRemove
} from './fs.ts'


Deno.test(`fs existsDirSync`, () => {
    // true test cases
    assert(existsDirSync(getAbsolutePath(`.${SEP}shared`)))
    assert(existsDir(getAbsolutePath(getStandardFolder())))
    // false test cases
    assertEquals(existsDirSync(getAbsolutePath(`.${SEP}foobar`)), false)
    assertEquals(existsDirSync(getAbsolutePath(`.${SEP}shared${SEP}fs.ts`)), false)
    assertEquals(existsDirSync(getAbsolutePath('&*^--%$#@')), false)
    // error test cases
    assertThrows(() => existsDirSync({} as string), Error)
})

Deno.test(`fs async existsDir`, async () => {
    // true test cases
    assertEquals(await existsDir(getAbsolutePath(getStandardFolder())), true)
    assertEquals(await existsDir(getAbsolutePath(`.${SEP}shared`)), true)
    // false test cases
    assertEquals(await existsDir(getAbsolutePath(`.${SEP}foobar`)), false)
    assertEquals(await existsDir(getAbsolutePath(`.${SEP}shared${SEP}fs.ts`)), false)
    assertEquals(await existsDir(getAbsolutePath('&*^--%$#@')), false)
    // error test cases
    existsDir({} as string).then(err => {
        assert(err instanceof Error)
    }).catch(e => console.error(e))
})

Deno.test(`fs existsFileSync`, () => {
    // true test cases
    assert(existsFileSync(getAbsolutePath(`.${SEP}shared${SEP}fs.ts`)))
    // false test cases
    assert(!existsFileSync(getAbsolutePath(`.${SEP}shared`)))
    assert(!existsFileSync(getAbsolutePath(`.${SEP}shared${SEP}baz.ts`)))
    // error test cases
    assertThrows(() => existsDirSync({} as string), Error)
})

Deno.test(`fs async existsFile`, async () => {
    // true test cases
    assert(await existsFile(getAbsolutePath(`.${SEP}shared${SEP}fs.ts`)))
    // false test cases
    assertEquals(await existsFile(getAbsolutePath(`.${SEP}shared${SEP}foobar.ts`)), false)
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
    // FIXME: false test case
    // illegal folder name
    // const textFilePath2 = `${SEP}test2.txt`
    // let testContent2 = ''
    // try {
    //     await ensureTextFile(textFilePath2, content)
    //     testContent2 = await Deno.readTextFile(textFilePath2)
    // } catch (error) {
    //     assertNotEquals(testContent2, content)
    // }
})

Deno.test('lazyRemove', async () => {
    // true test
    const filePath = await Deno.makeTempFile()
    await lazyRemove(filePath)
    assertEquals(existsFileSync(filePath), false)
    // false test
    const dirPath = await Deno.makeTempDir()
    await lazyRemove(`${dirPath}${SEP}asdfsdf.txt`)
    assert(await existsDir(dirPath))
    // error test
    lazyRemove({} as string).then(err => {
        assert(err instanceof Error)
    }).catch(e => console.error(e))

})

/**
 * Test of local function getAbsolutePath
 */
Deno.test('getAbsolutePath', () => {
    // folder
    let path = 'shared'
    let absPath = getAbsolutePath(path)
    assert(Deno.lstatSync(absPath).isDirectory)
    path = `.${SEP}shared`
    absPath = getAbsolutePath(path)
    assert(Deno.lstatSync(absPath).isDirectory)
    // file
    path = `shared${SEP}fs.ts`
    absPath = getAbsolutePath(path)
    assert(Deno.lstatSync(absPath).isFile)
    path = `.${SEP}shared${SEP}fs.ts`
    absPath = getAbsolutePath(path)
    assert(Deno.lstatSync(absPath).isFile)
})

/**
 * Returns an operating system-specific
 * example folder.
 * @returns 'C:\Program Files' for Windows or
 *  '/tmp' for unix-based operating systems
 */
const getStandardFolder = () => {
    return Deno.build.os === 'windows' ? 'C:\Program Files' : '/tmp'
}


/**
 * This function is designed to be used in this module
 * for test cases involving a file or directory. It
 * takes a path to a folder or file and converts it to an
 * absolute path. Designed to be os-agnostic by using
 * the SEP path separator from the Deno standard (std)
 * library (separator module).
 *
 * <strong>Note:</strong> This function might need to
 * be modified when the test is run in a CI/CD environment
 * depending where the tests are run. The current
 * implementation assumes that the tests are being
 * run from the repo's root folder.
 *
 * @param path relative or absolute path string to a folder
 *  or file. If the string starts with a operating-system
 *  agnostic slash, then it is assumed to be a full path;
 *  if the path starts with a dot slash (./) or no
 *  slash, then the path argument is assumed to be
 *  a relative path
 * @returns the full path to the folder or file
 */
const getAbsolutePath = (path: string): string => {
    const cwd = Deno.cwd()
    let fullRelativePath
    let absolutePath
    if (path.startsWith(`.${SEP}`)) { // dot slash
        // path == local relative path
        fullRelativePath = path.substring(1)
        absolutePath = `${cwd}${fullRelativePath}`
        // absolutePath = Deno.realPathSync(path)
        // console.log('REAL PATH: ', absolutePath)
    } else if (path.startsWith(SEP)) { // slash
        // path === absolute path
        absolutePath = Deno.realPathSync(path)
    } else if (path.startsWith('C:\\')) { // windows full path
        // path === absolute path
        absolutePath = Deno.realPathSync(path)
    } else { // no dot or slash at start of path
        // path == local relative path
        fullRelativePath = path
        absolutePath = `${cwd}${SEP}${fullRelativePath}`
    }
    return absolutePath
}