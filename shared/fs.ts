import { ensureDir, path } from '../deps.ts'
import { reHashJs } from './constants.ts'
import util from './util.ts'

/* check whether or not the given path exists as a directory */
export async function existsDir(path: string) {
    try {
        const fi = await Deno.lstat(path)
        if (fi.isDirectory) {
            return true
        }
        return false
    } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
            return false
        }
        throw err
    }
}

/* check whether or not the given path exists as a directory */
export function existsDirSync(path: string) {
    try {
        const fi = Deno.lstatSync(path)
        if (fi.isDirectory) {
            return true
        }
        return false
    } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
            return false
        }
        throw err
    }
}

/* check whether or not the given path exists as regular file */
export async function existsFile(path: string) {
    try {
        const fi = await Deno.lstat(path)
        if (fi.isFile) {
            return true
        }
        return false
    } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
            return false
        }
        throw err
    }
}

/* check whether or not the given path exists as regular file */
export function existsFileSync(path: string) {
    try {
        const fi = Deno.lstatSync(path)
        if (fi.isFile) {
            return true
        }
        return false
    } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
            return false
        }
        throw err
    }
}

/** ensure and write a text file */
export async function ensureTextFile(name: string, content: string) {
    const dir = path.dirname(name)
    await ensureDir(dir)
    await Deno.writeTextFile(name, content)
}

/** cleanup the previous compilation cache */
export async function cleanupCompilation(jsFile: string) {
    const dir = path.dirname(jsFile)
    const jsFileName = path.basename(jsFile)
    if (!reHashJs.test(jsFile) || !existsDirSync(dir)) {
        return
    }
    const jsName = jsFileName.split('.').slice(0, -2).join('.') + '.js'
    for await (const entry of Deno.readDir(dir)) {
        if (entry.isFile && (entry.name.endsWith('.js') || entry.name.endsWith('.js.map'))) {
            const _jsName = util.trimSuffix(entry.name, '.map').split('.').slice(0, -2).join('.') + '.js'
            if (_jsName === jsName && jsFileName !== entry.name) {
                await Deno.remove(path.join(dir, entry.name))
            }
        }
    }
}
