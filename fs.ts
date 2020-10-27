import { ensureDir, path } from './std.ts'

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
