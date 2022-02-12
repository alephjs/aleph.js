import { join } from "https://deno.land/std@0.125.0/path/mod.ts";

/* check whether or not the given path exists as a directory. */
export async function existsDir(path: string): Promise<boolean> {
  try {
    const stat = await Deno.lstat(path);
    return stat.isDirectory;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false;
    }
    throw err;
  }
}

/* check whether or not the given path exists as regular file. */
export async function existsFile(path: string): Promise<boolean> {
  try {
    const stat = await Deno.lstat(path);
    return stat.isFile;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false;
    }
    throw err;
  }
}

export async function findFile(
  wd: string,
  filenames: string[],
): Promise<string | undefined> {
  for (const filename of filenames) {
    const fullPath = join(wd, filename);
    if (await existsFile(fullPath)) {
      return fullPath;
    }
  }
  return void 0;
}
