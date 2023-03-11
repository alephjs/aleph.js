import { splitPath, trimSuffix } from "../../shared/util.ts";
import type { URLPatternInput, URLPatternResult } from "./url_pattern.ts";
import { createStaticURLPatternResult, URLPatternCompat } from "./url_pattern.ts";
import { FetchError } from "./error.ts";

export type RouteModule = {
  url: URL;
  params: Record<string, string>;
  filename: string;
  exports: Record<string, unknown>;
  withData?: boolean;
  data?: unknown;
  dataCacheTtl?: number;
};

export type RouteMeta = {
  filename: string;
  pattern: URLPatternInput;
  nesting?: boolean;
};

export type RouteData = {
  data?: unknown;
  dataCacheTtl?: number;
  dataExpires?: number;
};

export type Route = readonly [
  pattern: URLPatternCompat,
  meta: RouteMeta,
];

export type Router = {
  appDir?: string;
  prefix: string;
  routes: Route[];
  _404?: Route;
  _app?: Route;
};

export type RouteRegExp = {
  prefix: string;
  test(filename: string): boolean;
  exec(filename: string): URLPatternInput | null;
};

export type RouteMatch = [ret: URLPatternResult, route: RouteMeta];

/** match routes against the given url */
// todo: support basePath
export function matchRoutes(url: URL, router: Router): RouteMatch[] {
  const { routes, _app, _404 } = router;
  let { pathname } = url;
  if (pathname !== "/") {
    pathname = trimSuffix(pathname, "/");
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
      const parts = splitPath(pathname);
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

export function loadRouterFromTag(): Router {
  const el = window.document?.getElementById("router-manifest");
  if (el) {
    try {
      const manifest = JSON.parse(el.innerText);
      if (Array.isArray(manifest.routes)) {
        let _app: Route | undefined = undefined;
        let _404: Route | undefined = undefined;
        const routes = manifest.routes.map((meta: RouteMeta) => {
          const { pattern } = meta;
          const route: Route = [new URLPatternCompat(pattern), meta];
          if (pattern.pathname === "/_app") {
            _app = route;
          } else if (pattern.pathname === "/_404") {
            _404 = route;
          }
          return route;
        });
        return { routes, prefix: manifest.prefix, _app, _404 };
      }
    } catch (e) {
      throw new Error(`loadRouteConfigFromTag: ${e.message}`);
    }
  }
  return { routes: [], prefix: "" };
}

// prefetch route data
export async function prefetchRouteData(dataCache: Map<string, RouteData>, dataUrl: string, dataDefer?: boolean) {
  const rd: RouteData = {};
  const fetchData = async () => {
    const res = await fetch(dataUrl + (dataUrl.includes("?") ? "&" : "?") + "_data_");
    if (!res.ok) {
      const err = await FetchError.fromResponse(res);
      const details = err.details as { redirect?: { location: string } };
      if (err.status === 501 && typeof details.redirect?.location === "string") {
        location.href = details.redirect?.location;
        return;
      }
      return err;
    }
    try {
      const data = await res.json();
      const cc = res.headers.get("Cache-Control");
      rd.dataCacheTtl = cc?.includes("max-age=") ? parseInt(cc.split("max-age=")[1]) : undefined;
      rd.dataExpires = Date.now() + (rd.dataCacheTtl || 1) * 1000;
      return data;
    } catch (_e) {
      return new Error("Data must be valid JSON");
    }
  };
  if (dataDefer) {
    rd.data = fetchData;
  } else {
    rd.data = await fetchData();
  }
  dataCache.set(dataUrl, rd);
}

export function loadSSRModulesFromTag(): RouteModule[] {
  const el = window.document?.getElementById("ssr-data");
  if (el) {
    try {
      const data = JSON.parse(el.innerText);
      if (Array.isArray(data)) {
        let deferedData: Record<string, unknown> | null | undefined = undefined;
        return data.map(({ url, filename, dataDefered, ...rest }) => {
          const mod = __aleph.getRouteModule(filename);
          if (dataDefered) {
            if (deferedData === undefined) {
              const el = window.document?.getElementById("defered-data");
              if (el) {
                deferedData = JSON.parse(el.innerText);
              } else {
                deferedData = null;
              }
            }
            if (deferedData) {
              rest.data = deferedData[url];
            } else {
              rest.data = Promise.resolve(null);
            }
          }
          if (rest.error) {
            rest.data = new FetchError(500, rest.error.message, { stack: rest.error.stack });
            rest.error = undefined;
          }
          return <RouteModule> {
            url: new URL(url, location.href),
            filename,
            exports: mod,
            ...rest,
          };
        });
      }
    } catch (e) {
      throw new Error(`loadSSRModulesFromTag: ${e.message}`);
    }
  }
  return [];
}
