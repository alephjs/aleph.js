import { URLPatternCompat, type URLPatternInput } from "../framework/core/url_pattern.ts";
import type { RouteMatch, RouteMeta, RoutePattern, Router } from "../framework/core/router.ts";
import {
  cleanPath,
  isFilledString,
  isPlainObject,
  splitBy,
  splitPath,
  trimPrefix,
  trimSuffix,
  unique,
} from "../shared/util.ts";
import { path } from "./deps.ts";
import depGraph from "./graph.ts";
import log from "./log.ts";
import { builtinModuleExts, getAlephConfig, getAppDir, getFiles, toResponse } from "./helpers.ts";
import type { Context, RouterInit } from "./types.ts";

/** import the route module. */
export async function importRouteModule({ filename, pattern }: RouteMeta, appDir?: string) {
  const config = getAlephConfig();
  const modules = config?.router?.modules;
  if (modules && pattern.pathname in modules) {
    return modules[pattern.pathname];
  }

  const version = depGraph.get(filename)?.version;
  const origin = Reflect.get(globalThis, "__ALEPH_SERVER_ORIGIN");

  let url: string;
  if (origin) {
    url = `${origin}${cleanPath(filename)}?ssr&v=${(version ?? depGraph.globalVersion).toString(36)}`;
  } else {
    const root = appDir ? path.resolve(appDir) : getAppDir();
    url = `file://${path.join(root, filename)}${version ? "#" + version.toString(36) : ""}`;
  }

  return await import(url);
}

/** fetch the route. */
export async function fetchRoute(req: Request, ctx: Context, router: Router): Promise<Response | void> {
  const { pathname, host, searchParams } = new URL(req.url);
  const hasDataParam = searchParams.has("_data_");
  if (router.routes.length > 0) {
    let pathnameInput = pathname;
    if (pathnameInput !== "/") {
      pathnameInput = trimSuffix(pathname, "/");
    }
    let matched: RouteMatch | null = null;
    // find the direct match
    for (const [pattern, meta] of router.routes) {
      const ret = pattern.exec({ host, pathname: pathnameInput });
      if (ret) {
        matched = [ret, meta];
        break;
      }
    }
    if (!matched) {
      // find index route
      for (const [pattern, meta] of router.routes) {
        if (meta.pattern.pathname.endsWith("/index")) {
          const ret = pattern.exec({ host, pathname: pathnameInput + "/index" });
          if (ret) {
            matched = [ret, meta];
            break;
          }
        }
      }
    }
    if (matched) {
      const { method } = req;
      const [ret, meta] = matched;
      const mod = await importRouteModule(meta, router.appDir);
      if (method !== "GET" || (hasDataParam || typeof mod.GET === "function")) {
        let fetcher: unknown;
        let cacheTtl: number | undefined;
        if (method === "GET") {
          if (hasDataParam) {
            if (typeof mod.data === "function") {
              fetcher = mod.data;
            } else if (isPlainObject(mod.data)) {
              fetcher = mod.data.fetch;
              cacheTtl = mod.data.cacheTtl;
            } else {
              fetcher = () => null; // empty data
            }
          } else {
            fetcher = mod.GET;
          }
        } else {
          if (typeof mod.mutation === "function") {
            fetcher = mod.mutation;
          } else if (isPlainObject(mod.mutation)) {
            fetcher = mod.mutation[method] ?? mod.mutation[method.toLowerCase()];
          }
          if (typeof fetcher !== "function") {
            fetcher = mod[method];
          }
        }
        if (typeof fetcher === "function") {
          Object.assign(ctx.params as Record<string, string>, ret.pathname.groups);
          const res = await fetcher(req, ctx);
          const headers = new Headers({
            "Cache-Control": cacheTtl ? `public, max-age=${cacheTtl}` : "no-cache, no-store, must-revalidate",
          });
          if (res instanceof Response) {
            return res;
          }
          return toResponse(res, { headers });
        }
        return new Response("Method Not Allowed", { status: 405 });
      }
    }
  }
}

/** initialize router from routes config */
export async function initRouter(appDir: string, init: RouterInit = {}): Promise<Router> {
  const reg = toRouterRegExp(init);
  const files = await getFiles(appDir);
  const routes: RoutePattern[] = [];
  let _app: RoutePattern | undefined = undefined;
  let _404: RoutePattern | undefined = undefined;
  files.forEach((filename) => {
    const pattern = reg.exec(filename);
    if (pattern && pattern.pathname !== "/_export" && !pattern.pathname.endsWith("_test")) {
      const route: RoutePattern = [
        new URLPatternCompat(pattern),
        { pattern, filename },
      ];
      routes.push(route);
      if (pattern.pathname === "/_app") {
        _app = route;
      } else if (pattern.pathname === "/_404") {
        _404 = route;
      }
    }
  });
  if (routes.length > 0) {
    // sort routes by length of pathname
    routes.sort((a, b) => getRouteOrder(a) - getRouteOrder(b));
    // check nesting routes
    routes.forEach(([_, meta]) => {
      const { pattern: { pathname } } = meta;
      const nesting = pathname === "/_app" || (pathname !== "/" && !pathname.endsWith("/index") &&
        routes.findIndex(([_, { pattern: { pathname: p } }]) => p !== pathname && p.startsWith(pathname + "/")) !==
          -1);
      if (nesting) {
        meta.nesting = true;
      }
    });
  }

  log.debug(`${routes.length} routes found`);
  return {
    appDir,
    routes,
    prefix: reg.prefix,
    _404,
    _app,
  };
}

/* check if the filename is a route */
export function isRouteModule(filename: string): boolean {
  const router: Router | undefined = Reflect.get(globalThis, "__ALEPH_ROUTER");
  const index = router?.routes?.findIndex(([_, meta]) => meta.filename === filename);
  if (index !== undefined && index !== -1) {
    return true;
  }
  const config = getAlephConfig();
  if (config?.router) {
    const reg = toRouterRegExp(config.router);
    return reg.test(filename);
  }
  return false;
}

/** convert route config to likely `RegExp` */
export function toRouterRegExp(init: RouterInit = {}) {
  let glob = init.glob;
  if (!isFilledString(glob)) {
    const exts = unique([...builtinModuleExts, ...(init.exts ?? [])].map((s) => trimPrefix(s, ".")));
    glob = `.${cleanPath(init.dir ?? "routes")}/**/*.{${exts.join(",")}}`;
  }
  const prefix = splitBy(glob, "/*")[0];
  const reg = path.globToRegExp("./" + trimPrefix(glob, "./"), { caseInsensitive: true });
  return {
    prefix,
    test: (s: string) => s !== prefix + "/_export.ts" && reg.test(s),
    exec: (filename: string): URLPatternInput | null => {
      if (reg.test(filename)) {
        const parts = splitPath(trimPrefix(filename, prefix)).map((part) => {
          // replace `/blog/[...path]` to `/blog/:path+`
          if (part.startsWith("[...") && part.includes("]") && part.length > 5) {
            return ":" + part.slice(4).replace("]", "+");
          }
          // replace `/blog/[id]` to `/blog/:id`
          if (part.startsWith("[") && part.includes("]") && part.length > 2) {
            return ":" + part.slice(1).replace("]", "");
          }
          // replace `/blog/$id` to `/blog/:id`
          if (part.startsWith("$") && part.length > 1) {
            return ":" + part.slice(1);
          }
          return part;
        });
        let host: string | undefined = undefined;
        if (parts.length > 1 && /^@[a-z0-9\.\-]+\.[a-z0-9]+$/.test(parts[0])) {
          host = parts.shift()!.slice(1);
        }
        const basename = parts.pop()!;
        const pathname = "/" + [...parts, trimSuffix(basename, path.extname(basename))].join("/");
        return { host, pathname: pathname === "/index" ? "/" : pathname };
      }
      return null;
    },
  };
}

/** get route order by pathname length */
function getRouteOrder([_, meta]: RoutePattern): number {
  const { pattern, filename } = meta;
  switch (pattern.pathname) {
    case "/_404":
    case "/_app":
      return 0;
    default:
      return filename.split("/").length + (pattern.pathname.split("/:").length - 1) * 0.01;
  }
}
