import type { URLPatternCompat, URLPatternInput, URLPatternResult } from "./urlpattern.ts";
import { createStaticURLPatternResult } from "./urlpattern.ts";
import util from "./util.ts";

export type RouteModule = {
  url: URL;
  filename: string;
  error?: Error;
  redirect?: { headers: Headers; status: number };
  defaultExport?: unknown;
  data?: unknown;
  dataCacheTtl?: number;
};

export type RouteMeta = {
  filename: string;
  pattern: URLPatternInput;
  nesting?: boolean;
};

export type Route = readonly [
  pattern: URLPatternCompat,
  meta: RouteMeta,
];

/** match routes against the given url */
export function matchRoutes(url: URL, routes: Route[]): [ret: URLPatternResult, route: RouteMeta][] {
  let { pathname } = url;
  if (pathname !== "/") {
    pathname = util.trimSuffix(url.pathname, "/");
  }
  const matches: [ret: URLPatternResult, route: RouteMeta][] = [];
  if (routes.length > 0) {
    routes.forEach(([pattern, meta]) => {
      const ret = pattern.exec({ host: url.host, pathname });
      if (ret) {
        matches.push([ret, meta]);
        // find the nesting index of the route
        if (meta.nesting && meta.pattern.pathname !== "/_app") {
          for (const [p, m] of routes) {
            const [_, name] = util.splitBy(m.pattern.pathname, "/", true);
            if (!name.startsWith(":")) {
              const ret = p.exec({ host: url.host, pathname: pathname + "/index" });
              if (ret) {
                matches.push([ret, m]);
                break;
              }
            }
          }
        }
      } else if (meta.nesting) {
        const parts = util.splitPath(pathname);
        for (let i = parts.length - 1; i > 0; i--) {
          const pathname = "/" + parts.slice(0, i).join("/");
          const ret = pattern.exec({ host: url.host, pathname });
          if (ret) {
            matches.push([ret, meta]);
            break;
          }
        }
      }
    });
    if (matches.filter(([_, meta]) => !meta.nesting).length === 0) {
      for (const [_, meta] of routes) {
        if (meta.pattern.pathname === "/_404") {
          matches.push([createStaticURLPatternResult(url.host, "/_404"), meta]);
          break;
        }
      }
    }
    if (matches.length > 0) {
      for (const [_, meta] of routes) {
        if (meta.pattern.pathname === "/_app") {
          matches.unshift([createStaticURLPatternResult(url.host, "/_app"), meta]);
          break;
        }
      }
    }
  }
  return matches;
}
