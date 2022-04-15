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

export type Routes = {
  _404?: Route;
  _app?: Route;
  _error?: Route;
  routes: Route[];
};

/** match routes against the given url */
export function matchRoutes(
  url: URL,
  { routes, _app, _404 }: Routes,
): [ret: URLPatternResult, route: RouteMeta][] {
  let { pathname } = url;
  if (pathname !== "/") {
    pathname = util.trimSuffix(url.pathname, "/");
  }
  const matches: [ret: URLPatternResult, route: RouteMeta][] = [];
  if (routes.length > 0) {
    // find the direct match
    for (const [pattern, meta] of routes) {
      const { pathname: pp } = meta.pattern;
      if (pp !== "/_app" && pp !== "/_404") {
        const ret = pattern.exec({ host: url.host, pathname });
        if (ret) {
          matches.push([ret, meta]);
          break;
        }
      }
    }
    if (matches.length === 0) {
      // find index route
      for (const [p, m] of routes) {
        if (m.pattern.pathname.endsWith("/index")) {
          const ret = p.exec({ host: url.host, pathname: pathname + "/index" });
          if (ret) {
            matches.push([ret, m]);
            break;
          }
        }
      }
    }
    if (matches.length > 0) {
      const directMatch = matches[matches.length - 1][1];
      const parts = util.splitPath(pathname);
      const nestRoutes = routes.filter(([_, m]) =>
        m.nesting && m.pattern.pathname !== "/_app" && directMatch.pattern.pathname.startsWith(m.pattern.pathname + "/")
      );
      // lookup nesting parent
      for (let i = parts.length - 1; i > 0; i--) {
        const pathname = "/" + parts.slice(0, i).join("/");
        for (const [pattern, meta] of nestRoutes) {
          const ret = pattern.exec({ host: url.host, pathname });
          if (ret) {
            matches.unshift([ret, meta]);
            break;
          }
        }
      }

      if (directMatch.nesting) {
        // find index route
        for (const [p, m] of routes) {
          if (m.pattern.pathname === directMatch.pattern.pathname + "/index") {
            const ret = p.exec({ host: url.host, pathname: pathname + "/index" });
            if (ret) {
              matches.push([ret, m]);
              break;
            }
          }
        }
      }
    }
    if (_404 && (matches.length === 0 || matches.filter(([_, meta]) => !meta.nesting).length === 0)) {
      matches.push([createStaticURLPatternResult(url.host, "/_404"), _404[1]]);
    }
    if (_app && matches.length > 0) {
      matches.unshift([createStaticURLPatternResult(url.host, "/_app"), _app[1]]);
    }
  }
  return matches;
}
