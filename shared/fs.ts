import { dirname } from 'https://deno.land/std@0.90.0/path/mod.ts'
import { ensureDir } from 'https://deno.land/std@0.90.0/fs/ensure_dir.ts'

/* check whether or not the given path exists as a directory. */
export async function existsDir(path: string): Promise<boolean> {
  try {
    if (path.startsWith('/') && Deno.build.os === "windows") path = path.substr(1)
    const fi = await Deno.lstat(path)
    if (fi.isDirectory) {
      return true
    }
    return false
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false
    }
    return Promise.reject(err)
  }
}

/* check whether or not the given path exists as a directory. */
export function existsDirSync(path: string) {
  try {
    if (path.startsWith('/') && Deno.build.os === "windows") path = path.substr(1)
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

/* check whether or not the given path exists as regular file. */
export async function existsFile(path: string): Promise<boolean> {
  try {
    if (path.startsWith('/') && Deno.build.os === "windows") path = path.substr(1)
    const fi = await Deno.lstat(path)
    if (fi.isFile) {
      return true
    }
    return false
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false
    }
    return Promise.reject(err)
  }
}

/* check whether or not the given path exists as regular file. */
export function existsFileSync(path: string) {
  try {
    if (path.startsWith('/') && Deno.build.os === "windows") path = path.substr(1)
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

/** ensure and write a text file. */
export async function ensureTextFile(name: string, content: string): Promise<void> {
  if (name.startsWith('/') && Deno.build.os === "windows") name = name.substr(1)
  const dir = dirname(name)
  await ensureDir(dir)
  await Deno.writeTextFile(name, content)
}

/** remove the file if it exists. */
export async function lazyRemove(name: string, options?: { recursive?: boolean }): Promise<void> {
  try {
    if (name.startsWith('/') && Deno.build.os === "windows") name = name.substr(1)
    await Deno.remove(name, options)
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return
    }
    return Promise.reject(err)
  }
}
