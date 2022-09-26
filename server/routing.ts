import { URLPatternCompat, type URLPatternInput } from "../runtime/core/url_pattern.ts";
import { getFiles } from "../shared/fs.ts";
import util from "../shared/util.ts";
import { extname, fromFileUrl, globToRegExp, join, resolve } from "./deps.ts";
import depGraph from "./graph.ts";
import log from "./log.ts";
import { builtinModuleExts, fixResponse, getAlephConfig, toResponse } from "./helpers.ts";
import type { Context, Route, RouteMatch, RouteMeta, Router, RouteRegExp, RouterInit } from "./types.ts";

/** import the route module. */
export async function importRouteModule({ filename, pattern }: RouteMeta, appDir?: string) {
  const config = getAlephConfig();
  const routes = config?.router?.routes;
  if (routes && pattern.pathname in routes) {
    return routes[pattern.pathname];
  }

  const origin = Deno.env.get("ALEPH_SERVER_ORIGIN");
  const version = depGraph.get(filename)?.version;
  let url: string;
  if (origin) {
    url = `${origin}${filename.slice(1)}?ssr&v=${(version ?? depGraph.globalVersion).toString(36)}`;
  } else {
    const root = appDir ? resolve(appDir) : (config?.baseUrl ? fromFileUrl(new URL(".", config.baseUrl)) : Deno.cwd());
    url = `file://${join(root, filename)}${version ? "#" + version.toString(36) : ""}`;
  }
  return await import(url);
}

export async function fetchRouteData(
  req: Request,
  ctx: Context,
  router: Router,
  _data_: boolean,
): Promise<Response | void> {
  const { pathname, host } = new URL(req.url);
  if (router.routes.length > 0) {
    let pathnameInput = pathname;
    if (pathnameInput !== "/") {
      pathnameInput = util.trimSuffix(pathname, "/");
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
      const dataConfig = util.isPlainObject(mod.data) ? mod.data : mod;
      if (method !== "GET" || mod.default === undefined || _data_) {
        Object.assign(ctx.params as Record<string, string>, ret.pathname.groups);
        const anyFetcher = dataConfig.any ?? dataConfig.ANY;
        if (typeof anyFetcher === "function") {
          const res = await anyFetcher(req, ctx);
          if (res instanceof Response) {
            return res;
          }
        }
        const fetcher = dataConfig[method.toLowerCase()] ?? dataConfig[method];
        if (typeof fetcher === "function") {
          const res = await fetcher(req, ctx);
          const headers = ctx.headers as unknown as Headers;
          // todo: set cache for "GET" with `cacheTtl` option
          headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
          if (res instanceof Response) {
            return fixResponse(res, headers, _data_);
          }
          return toResponse(res, headers);
        }
        return new Response("Method Not Allowed", { status: 405 });
      }
    }
  }
}

/** initialize router from routes config */
export async function initRouter(options: RouterInit, appDir?: string): Promise<Router> {
  const reg = toRouteRegExp(options);
  const files = await getFiles(appDir ?? Deno.cwd());
  const routes: Route[] = [];
  let _app: Route | undefined = undefined;
  let _404: Route | undefined = undefined;
  files.forEach((filename) => {
    const pattern = reg.exec(filename);
    if (pattern && pattern.pathname !== "/_export" && !pattern.pathname.endsWith("_test")) {
      const route: Route = [
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
  const router: Router | null | undefined = Reflect.get(globalThis, "__ALEPH_ROUTER");
  const index = router?.routes?.findIndex(([_, meta]) => meta.filename === filename);
  if (index !== undefined && index !== -1) {
    return true;
  }
  const config = getAlephConfig();
  if (config?.router) {
    const reg = toRouteRegExp(config.router);
    return reg.test(filename);
  }
  return false;
}

/** convert route config to `RouteRegExp` */
export function toRouteRegExp(init: RouterInit): RouteRegExp {
  const glob = util.isFilledString(init.glob)
    ? init.glob
    : `.${util.cleanPath(init.dir ?? "routes")}/**/*.{${
      (init.exts ?? builtinModuleExts).map((s) => util.trimPrefix(s, ".")).join(",")
    }}`;
  if (!glob) throw new Error("invalid router options: `glob` is required");
  const prefix = util.trimSuffix(util.splitBy(glob, "*")[0], "/");
  const reg = globToRegExp("./" + util.trimPrefix(glob, "./"));
  return {
    prefix,
    test: (s: string) => s !== prefix + "/_export.ts" && reg.test(s),
    exec: (filename: string): URLPatternInput | null => {
      if (reg.test(filename)) {
        const parts = util.splitPath(util.trimPrefix(filename, prefix)).map((part) => {
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
        const pathname = "/" + [...parts, util.trimSuffix(basename, extname(basename))].join("/");
        return { host, pathname: pathname === "/index" ? "/" : pathname };
      }
      return null;
    },
  };
}

/** get route order by pathname length */
function getRouteOrder([_, meta]: Route): number {
  const { pattern, filename } = meta;
  switch (pattern.pathname) {
    case "/_404":
    case "/_app":
      return 0;
    default:
      return filename.split("/").length + (pattern.pathname.split("/:").length - 1) * 0.01;
  }
}
