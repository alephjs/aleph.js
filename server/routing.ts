import { extname, globToRegExp, join } from "https://deno.land/std@0.125.0/path/mod.ts";
import { getFiles } from "../lib/fs.ts";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import { AlephConfig, Route, RoutePattern, RoutesConfig, RoutingRegExp } from "../types.d.ts";
import { type DependencyGraph } from "./graph.ts";

const currentRoutes: Route[] = [];
const routeModules: Map<string, Record<string, unknown>> = new Map();

export function register(filename: string, module: Record<string, unknown>) {
  routeModules.set(filename, module);
}

export function isRouteFile(filename: string): boolean {
  const index = currentRoutes.findIndex((r) => r[2].filename === filename);
  if (index !== -1) {
    return true;
  }
  const config: AlephConfig | undefined = Reflect.get(globalThis, "__ALEPH_CONFIG");
  if (config && config.routeFiles) {
    const reg = toRoutingRegExp(config.routeFiles);
    return reg.test(filename);
  }
  return false;
}

export async function initRoutes(config: string | RoutesConfig | RoutingRegExp): Promise<Route[]> {
  const reg = isRoutingRegExp(config) ? config : toRoutingRegExp(config);
  const files = await getFiles(join(Deno.cwd(), reg.prefix));
  const routes: Route[] = [];
  files.forEach((file) => {
    const filename = reg.prefix + file.slice(1);
    const pattern = reg.exec(filename);
    if (pattern) {
      routes.push([
        // deno-lint-ignore ban-ts-comment
        // @ts-ignore
        new URLPattern(pattern),
        async () => {
          let mod: Record<string, unknown>;
          if (routeModules.has(filename)) {
            mod = routeModules.get(filename)!;
          } else {
            const graph: DependencyGraph | undefined = Reflect.get(globalThis, "serverDependencyGraph");
            const gm = graph?.get(filename) || graph?.mark(filename, {});
            const port = Deno.env.get("ALEPH_APP_MODULES_PORT");
            const version = (gm?.version || Date.now()).toString(16);
            mod = await import(`http://localhost:${port}${filename.slice(1)}?v=${version}`);
          }
          return mod;
        },
        { pattern, filename },
      ]);
    }
  });
  log.info(`${routes.length || "No"} route${routes.length !== 1 ? "s" : ""} found from ${reg.prefix}`);
  currentRoutes.splice(0, currentRoutes.length, ...routes);
  return routes;
}

export function toRoutingRegExp(config: string | RoutesConfig): RoutingRegExp {
  const isObject = util.isPlainObject(config);
  const prefix = "." + util.cleanPath(isObject ? config.dir : config.split("*")[0]);
  const reg = isObject
    ? {
      test(s: string) {
        return s.startsWith(prefix) &&
          !!config.exts.find((ext) => ext.startsWith(".") ? s.endsWith(ext) : s.endsWith(`.${ext}`));
      },
    }
    : globToRegExp("./" + util.trimPrefix(util.trimPrefix(config, "/"), "./"));
  return {
    prefix,
    test: (s: string) => reg.test(s),
    exec: (filename: string): RoutePattern | null => {
      if (reg.test(filename)) {
        const parts = util.splitPath(util.trimPrefix(filename, prefix)).map((part) => {
          part = part.toLowerCase();
          if (part.startsWith("[") && part.startsWith("]")) {
            return ":" + part.slice(1, -1);
          } else if (part.startsWith("$")) {
            return ":" + part.slice(1);
          }
          return part;
        });
        let host: string | undefined = undefined;
        if (isObject && config.host && parts.length > 1 && parts[0].startsWith("@")) {
          host = parts.shift()!.slice(1);
        }
        const basename = parts.pop()!;
        const pathname =
          util.trimSuffix("/" + [...parts, util.trimSuffix(basename, extname(basename))].join("/"), "/index") || "/";
        return { host, pathname };
      }
      return null;
    },
  };
}

function isRoutingRegExp(v: unknown): v is RoutingRegExp {
  return util.isPlainObject(v) && typeof v.test === "function" && typeof v.exec === "function";
}
