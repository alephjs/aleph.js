import { extname, globToRegExp, join } from "https://deno.land/std@0.142.0/path/mod.ts";
import type { Route, RouteMatch, RouteTable } from "../framework/core/route.ts";
import { URLPatternCompat, type URLPatternInput } from "../framework/core/url_pattern.ts";
import { getFiles } from "../lib/fs.ts";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import type { DependencyGraph } from "./graph.ts";
import { fixResponse, toResponse } from "./helpers.ts";
import type { AlephConfig } from "./types.ts";

const revivedModules: Map<string, Record<string, unknown>> = new Map();

export async function fetchRouteData(
  routes: Route[],
  url: URL,
  req: Request,
  ctx: Record<string, unknown>,
  reqData: boolean,
  noProxy?: boolean,
): Promise<Response | void> {
  const { pathname, host } = url;
  if (routes.length > 0) {
    let pathnameInput = pathname;
    if (pathnameInput !== "/") {
      pathnameInput = util.trimSuffix(pathname, "/");
    }
    let matched: RouteMatch | null = null;
    // find the direct match
    for (const [pattern, meta] of routes) {
      const ret = pattern.exec({ host, pathname: pathnameInput });
      if (ret) {
        matched = [ret, meta];
        break;
      }
    }
    if (!matched) {
      // find index route
      for (const [pattern, meta] of routes) {
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
      const [ret, { filename }] = matched;
      const mod = await importRouteModule(filename, noProxy);
      const dataConfig = util.isPlainObject(mod.data) ? mod.data : mod;
      if (method !== "GET" || mod.default === undefined || reqData) {
        Object.assign(ctx.params, ret.pathname.groups);
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
          headers.set("cache-control", "no-cache, no-store, must-revalidate");
          if (res instanceof Response) {
            return fixResponse(res, headers, reqData);
          }
          return toResponse(res, headers);
        }
        return new Response("Method Not Allowed", { status: 405 });
      }
    }
  }
}

/** revive a route module. */
export function revive(filename: string, module: Record<string, unknown>) {
  if (Deno.env.get("ALEPH_ENV") !== "development") {
    revivedModules.set(filename, module);
  }
}

/** import the route module. */
export async function importRouteModule(filename: string, noProxy?: boolean) {
  let mod: Record<string, unknown>;
  if (revivedModules.has(filename)) {
    mod = revivedModules.get(filename)!;
  } else if (noProxy) {
    mod = await import(`file://${join(Deno.cwd(), filename)}`);
  } else {
    const graph: DependencyGraph | undefined = Reflect.get(globalThis, "__ALEPH_SERVER_DEP_GRAPH");
    const version = graph?.get(filename)?.version || graph?.mark(filename, {}).version || Date.now().toString(16);
    const port = Deno.env.get("ALEPH_MODULES_PROXY_PORT");
    mod = await import(`http://localhost:${port}${filename.slice(1)}?v=${version}`);
  }
  return mod;
}

/* check if the filename is a route */
export function isRouteFile(filename: string): boolean {
  const currentRoutes: RouteTable | undefined = Reflect.get(globalThis, "__ALEPH_ROUTES");
  const index = currentRoutes?.routes.findIndex(([_, meta]) => meta.filename === filename);
  if (index !== undefined && index !== -1) {
    return true;
  }
  const config: AlephConfig | undefined = Reflect.get(globalThis, "__ALEPH_CONFIG");
  if (config && config.routes) {
    const reg = toRouteRegExp(config.routes);
    return reg.test(filename);
  }
  return false;
}

type RouteRegExp = {
  prefix: string;
  generate?: boolean;
  test(filename: string): boolean;
  exec(filename: string): URLPatternInput | null;
};

/** initialize routes from routes config */
export async function initRoutes(config: string | RouteRegExp, cwd = Deno.cwd()): Promise<RouteTable> {
  const reg = isRouteRegExp(config) ? config : toRouteRegExp(config);
  const files = await getFiles(join(cwd, reg.prefix));
  const routes: Route[] = [];
  let _app: Route | undefined = undefined;
  let _404: Route | undefined = undefined;
  files.forEach((file) => {
    const filename = reg.prefix + file.slice(1);
    const pattern = reg.exec(filename);
    if (pattern) {
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

  log.debug(`${routes.length} routes initiated`);
  return { routes, _404, _app };
}

/** convert route config to `RouteRegExp` */
export function toRouteRegExp(config: string): RouteRegExp {
  const prefix = util.trimSuffix(util.splitBy(config, "*")[0], "/");
  const reg = globToRegExp("./" + util.trimPrefix(config, "./"));

  return {
    prefix,
    generate: Reflect.has(globalThis, "__ALEPH_ROUTES_GENERATE"),
    test: (s: string) => reg.test(s),
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

// check if route is index route
function isRouteRegExp(v: unknown): v is RouteRegExp {
  return util.isPlainObject(v) && typeof v.test === "function" && typeof v.exec === "function";
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
