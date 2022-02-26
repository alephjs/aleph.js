import { extname, globToRegExp, join } from "https://deno.land/std@0.125.0/path/mod.ts";
import { getFiles } from "../lib/fs.ts";
import log, { dim } from "../lib/log.ts";
import { URLPatternCompat, type URLPatternInput } from "../lib/url.ts";
import util from "../lib/util.ts";
import type { DependencyGraph } from "./graph.ts";
import type { AlephConfig, Route, RoutesConfig } from "./types.ts";

type RouteRegExp = {
  prefix: string;
  test(filename: string): boolean;
  exec(filename: string): URLPatternInput | null;
};

const routeModules: Map<string, Record<string, unknown>> = new Map();

/** register route module */
export function register(filename: string, module: Record<string, unknown>) {
  routeModules.set(filename, module);
}

/* check if the filename is a route */
export function isRouteFile(filename: string): boolean {
  const currentRoutes: Route[] | undefined = Reflect.get(globalThis, "__ALEPH_ROUTES");
  const index = currentRoutes?.findIndex((r) => r[2].filename === filename);
  if (index !== undefined && index !== -1) {
    return true;
  }
  const config: AlephConfig | undefined = Reflect.get(globalThis, "__ALEPH_CONFIG");
  if (config && config.routeFiles) {
    const reg = toRouteRegExp(config.routeFiles);
    return reg.test(filename);
  }
  return false;
}

/** initialize routes from routes config */
export async function initRoutes(config: string | RoutesConfig | RouteRegExp): Promise<Route[]> {
  const reg = isRouteRegExp(config) ? config : toRouteRegExp(config);
  const files = await getFiles(join(Deno.cwd(), reg.prefix));
  const routes: Route[] = [];
  files.forEach((file) => {
    const filename = reg.prefix + file.slice(1);
    const pattern = reg.exec(filename);
    if (pattern) {
      routes.push([
        new URLPatternCompat(pattern),
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
  if (routes.length > 0) {
    // roder routes by length of pathname
    routes.sort((a, b) => getRouteOrder(a) - getRouteOrder(b));
    // check if nesting routes
    routes.forEach(([_, __, meta]) => {
      const { pattern: { pathname }, filename } = meta;
      const nesting = pathname === "/_app" || (pathname !== "/" && !isIndexRoute(filename) &&
        routes.findIndex(([_, __, { pattern: { pathname: p } }]) => p !== pathname && p.startsWith(pathname + "/")) !==
          -1);
      if (nesting) {
        meta.nesting = true;
      }
    });
  }
  log.debug(`${routes.length || "No"} route${routes.length !== 1 ? "s" : ""} found from ${dim(reg.prefix)}`);
  Reflect.set(globalThis, "__ALEPH_ROUTES", routes);
  return routes;
}

/** convert route config to `RouteRegExp` */
export function toRouteRegExp(config: string | RoutesConfig): RouteRegExp {
  const isObject = util.isPlainObject(config);
  const prefix = "." + util.cleanPath(isObject ? config.dir : config.split("*")[0]);
  const reg = isObject
    ? {
      test: (s: string) =>
        s.startsWith(prefix) &&
        config.exts.findIndex((ext) => ext.startsWith(".") ? s.endsWith(ext) : s.endsWith(`.${ext}`)) !== -1,
    }
    : globToRegExp("./" + util.trimPrefix(util.trimPrefix(config, "/"), "./"));

  return {
    prefix,
    test: (s: string) => reg.test(s),
    exec: (filename: string): URLPatternInput | null => {
      if (reg.test(filename)) {
        const parts = util.splitPath(util.trimPrefix(filename, prefix)).map((part) => {
          part = toSlug(part);
          if (part.startsWith("[...") && part.startsWith("]") && part.length > 5) {
            return ":" + part.slice(4, -1) + "+";
          }
          if (part.startsWith("[") && part.startsWith("]") && part.length > 2) {
            return ":" + part.slice(1, -1);
          }
          if (part.startsWith("$") && part.length > 1) {
            return ":" + part.slice(1);
          }
          return part;
        });
        let host: string | undefined = undefined;
        if (isObject && config.host && parts.length > 1 && parts[0].startsWith("@")) {
          host = parts.shift()!.slice(1);
        }
        const basename = parts.pop()!;
        const pathname = "/" + [...parts, util.trimSuffix(basename, extname(basename))].join("/");
        return { host, pathname: pathname === "/index" ? "/" : pathname };
      }
      return null;
    },
  };
}

// check if route is index route
function isRouteRegExp(v: unknown): v is RouteRegExp {
  return util.isPlainObject(v) && typeof v.test === "function" && typeof v.exec === "function";
}

/** check if the file is index route */
function isIndexRoute(filename: string): boolean {
  return util.splitBy(filename, ".", true)[0].endsWith("/index");
}

/** slugify a string */
function toSlug(s: string): string {
  return s.replace(/\s+/g, "-").replace(/[^a-z0-9\-\[\]\/\$+_.@]/gi, "").toLowerCase();
}

/** get route order by pathname length */
function getRouteOrder(route: Route): number {
  const { pattern, filename } = route[2];
  switch (pattern.pathname) {
    case "/_404":
    case "/_app":
      return 0;
    default:
      return filename.split("/").length;
  }
}
