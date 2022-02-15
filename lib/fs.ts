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

/* find file in the directory */
export async function findFile(dir: string, filenames: string[]): Promise<string | undefined> {
  for (const filename of filenames) {
    const fullPath = join(dir, filename);
    if (await existsFile(fullPath)) {
      return fullPath;
    }
  }
  return void 0;
}

export const watchFs = async (dir: string, listener: (path: string, kind: "create" | "remove" | "modify") => void) => {
  const timers = new Map();
  const debounce = (id: string, callback: () => void, delay: number) => {
    if (timers.has(id)) {
      clearTimeout(timers.get(id)!);
    }
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        callback();
      }, delay),
    );
  };
  const w = Deno.watchFs(dir, { recursive: true });
  for await (const { kind, paths } of w) {
    for (const path of paths) {
      debounce(kind + path, async () => {
        try {
          await Deno.lstat(path);
          listener(path, kind === "create" ? "create" : "modify");
        } catch (error) {
          if (error instanceof Deno.errors.NotFound) {
            listener(path, "remove");
          } else {
            console.warn("watchFs:", error);
          }
        }
      }, 50);
    }
  }
};
