import { join } from "https://deno.land/std@0.136.0/path/mod.ts";
import cache from "./cache.ts";
import { getContentType } from "./mime.ts";
import util from "./util.ts";

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
export async function findFile(filenames: string[]): Promise<string | undefined> {
  const cwd = Deno.cwd();
  for (const filename of filenames) {
    const fullPath = join(cwd, filename);
    if (await existsFile(fullPath)) {
      return fullPath;
    }
  }
  return void 0;
}

// get files in the directory
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

/* read source code from fs/cdn/cache */
export async function readCode(
  specifier: string,
): Promise<[code: string, contentType: string]> {
  if (util.isLikelyHttpURL(specifier)) {
    const url = new URL(specifier);
    if (url.hostname === "esm.sh" && !url.searchParams.has("target")) {
      url.searchParams.set("target", "esnext");
    }
    const res = await cache(url.href);
    if (res.status >= 400) {
      throw new Error(`fetch ${url.href}: ${res.status} - ${res.statusText}`);
    }
    return [await res.text(), res.headers.get("Content-Type") || getContentType(url.pathname)];
  }

  specifier = util.splitBy(specifier, "?")[0];
  return [await Deno.readTextFile(specifier), getContentType(specifier)];
}

/* watch the given directory and its subdirectories */
export const watchFs = async (dir: string, listener: (kind: "create" | "remove" | "modify", path: string) => void) => {
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
  const ignoreReg = /[\/\\](\.git(hub)?|\.vscode|vendor|node_modules|dist|output|target)[\/\\]/;
  const ignore = (path: string) => ignoreReg.test(path) || path.endsWith(".DS_Store");
  const allFiles = new Set<string>(
    (await getFiles(dir)).map((name) => join(dir, name)).filter((path) => !ignore(path)),
  );
  for await (const { kind, paths } of w) {
    if (kind !== "create" && kind !== "remove" && kind !== "modify") {
      continue;
    }
    for (const path of paths) {
      if (ignore(path)) {
        continue;
      }
      debounce(kind + path, async () => {
        try {
          await Deno.lstat(path);
          if (!allFiles.has(path)) {
            allFiles.add(path);
            listener("create", path);
          } else {
            listener("modify", path);
          }
        } catch (error) {
          if (error instanceof Deno.errors.NotFound) {
            allFiles.delete(path);
            listener("remove", path);
          } else {
            console.warn("watchFs:", error);
          }
        }
      }, 100);
    }
  }
};
