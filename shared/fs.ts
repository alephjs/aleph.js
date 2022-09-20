import { join } from "https://deno.land/std@0.155.0/path/mod.ts";

/** Check whether or not the given path exists as a directory. */
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

/** Check whether or not the given path exists as regular file. */
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

/** Find file in the `cwd` directory. */
export async function findFile(filenames: string[], cwd = Deno.cwd()): Promise<string | undefined> {
  for (const filename of filenames) {
    const fullPath = join(cwd, filename);
    if (await existsFile(fullPath)) {
      return fullPath;
    }
  }
}

/** Get files in the directory. */
export async function getFiles(
  dir: string,
  filter?: (filename: string) => boolean,
  __path: string[] = [],
): Promise<string[]> {
  const list: string[] = [];
  if (await existsDir(dir)) {
    for await (const dirEntry of Deno.readDir(dir)) {
      if (dirEntry.isDirectory) {
        list.push(...await getFiles(join(dir, dirEntry.name), filter, [...__path, dirEntry.name]));
      } else {
        const filename = [".", ...__path, dirEntry.name].join("/");
        if (!filter || filter(filename)) {
          list.push(filename);
        }
      }
    }
  }
  return list;
}
