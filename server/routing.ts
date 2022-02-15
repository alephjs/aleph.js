import { extname, globToRegExp, join } from "https://deno.land/std@0.125.0/path/mod.ts";
import log, { dim } from "../lib/log.ts";
import util from "../lib/util.ts";
import { RouteConfig } from "../types.d.ts";

const routeModules: Map<string, any> = new Map();

export async function registerRoute(filename: string, component?: unknown, dataMethods?: Record<string, unknown>) {
  routeModules.set(filename, { default: component, data: dataMethods });
}

export async function getRoutes(glob: string): Promise<RouteConfig[]> {
  const global = globalThis as any;
  if (global.__ALEPH_ROUTES) {
    return global.__ALEPH_ROUTES;
  }

  const reg = globToRegExp(glob);
  const cwd = Deno.cwd();
  const files = await getFiles(cwd, (filename) => reg.test(filename));
  const routes = await Promise.all(files.map(async (filename): Promise<RouteConfig> => {
    const [prefix] = glob.split("*");
    const p = "/" + util.splitPath(util.trimPrefix(filename, util.trimSuffix(prefix, "/"))).map((part) => {
      part = part.toLowerCase();
      if (part.startsWith("[") && part.startsWith("]")) {
        return ":" + part.slice(1, -1);
      } else if (part.startsWith("$")) {
        return ":" + part.slice(1);
      }
      return part;
    }).join("/");
    const pathname = util.trimSuffix(util.trimSuffix(p, extname(p)), "/index") || "/";
    log.debug(dim("[route]"), pathname);
    return [
      // @ts-ignore
      new URLPattern({ pathname }),
      async () => {
        let mod: any;
        if (routeModules.has(filename)) {
          mod = routeModules.get(filename);
        } else {
          const port = Deno.env.get("ALEPH_APP_MODULES_PORT");
          const importUrl = `http://localhost:${port}${join(cwd, filename)}`;
          const mtime = (await Deno.lstat(filename)).mtime?.getTime().toString(16);
          mod = await import(`${importUrl}?v=${mtime}`);
        }
        return mod;
      },
      { pattern: { pathname }, filename },
    ];
  }));
  global.__ALEPH_ROUTES = routes;
  return routes;
}

async function getFiles(dir: string, filter?: (filename: string) => boolean, path: string[] = []): Promise<string[]> {
  const list: string[] = [];
  for await (const dirEntry of Deno.readDir(dir)) {
    if (dirEntry.isDirectory) {
      list.push(...await getFiles(join(dir, dirEntry.name), filter, [...path, dirEntry.name]));
    } else {
      const filename = [".", ...path, dirEntry.name].join("/");
      if (!filter || filter(filename)) {
        list.push(filename);
      }
    }
  }
  return list;
}
