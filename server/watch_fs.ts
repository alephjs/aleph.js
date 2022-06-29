import { join, relative } from "https://deno.land/std@0.145.0/path/mod.ts";
import mitt, { Emitter } from "https://esm.sh/mitt@3.0.0";
import { getFiles } from "./helpers.ts";
import type { DependencyGraph } from "./graph.ts";

type FsEvents = {
  [key in "create" | "remove" | `modify:${string}` | `hotUpdate:${string}`]: { specifier: string };
};

export const emitters = new Set<Emitter<FsEvents>>();

export function createFsEmitter() {
  const e = mitt<FsEvents>();
  emitters.add(e);
  return e;
}

export function removeFsEmitter(e: Emitter<FsEvents>) {
  e.all.clear();
  emitters.delete(e);
}

/* watch the directory and its subdirectories */
export async function watchFs(appDir?: string) {
  const dir = appDir ? join(Deno.cwd(), appDir) : Deno.cwd();
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
  const listener = (kind: "create" | "remove" | "modify", path: string) => {
    const specifier = "./" + relative(Deno.cwd(), path).replaceAll("\\", "/");
    const clientDependencyGraph: DependencyGraph | undefined = Reflect.get(globalThis, "__ALEPH_CLIENT_DEP_GRAPH");
    const serverDependencyGraph: DependencyGraph | undefined = Reflect.get(globalThis, "__ALEPH_SERVER_DEP_GRAPH");
    if (kind === "remove") {
      clientDependencyGraph?.unmark(specifier);
      serverDependencyGraph?.unmark(specifier);
    } else {
      clientDependencyGraph?.update(specifier);
      serverDependencyGraph?.update(specifier);
    }
    // delete global cached index html
    if (specifier === "./index.html") {
      Reflect.deleteProperty(globalThis, "__ALEPH_INDEX_HTML");
    }
    if (kind === "modify") {
      emitters.forEach((e) => {
        e.emit(`modify:${specifier}`, { specifier });
        if (e.all.has(`hotUpdate:${specifier}`)) {
          e.emit(`hotUpdate:${specifier}`, { specifier });
        } else if (specifier !== "./routes.gen.ts") {
          clientDependencyGraph?.lookup(specifier, (specifier) => {
            if (e.all.has(`hotUpdate:${specifier}`)) {
              e.emit(`hotUpdate:${specifier}`, { specifier });
              return false;
            }
          });
          serverDependencyGraph?.lookup(specifier, (specifier) => {
            if (e.all.has(`hotUpdate:${specifier}`)) {
              e.emit(`hotUpdate:${specifier}`, { specifier });
              return false;
            }
          });
        }
      });
    }
  };
  const reIgnore = /[\/\\](\.git(hub)?|\.vscode|vendor|node_modules|dist|out(put)?|target)[\/\\]/;
  const ignore = (path: string) => reIgnore.test(path) || path.endsWith(".DS_Store");
  const allFiles = new Set<string>(
    (await getFiles(dir)).map((name) => join(dir, name)).filter((path) => !ignore(path)),
  );
  for await (const { kind, paths } of Deno.watchFs(dir, { recursive: true })) {
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
}
