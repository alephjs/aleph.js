import type { Route, RouteMeta } from "../server/types.ts";
import { createStaticURLPatternResult, type URLPatternResult } from "./urlpattern.ts";
import util from "./util.ts";

export const builtinModuleExts = ["tsx", "ts", "mts", "jsx", "js", "mjs"];

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

/**
 * fix remote url to local path.
 * e.g. `https://esm.sh/react@17.0.2` -> `/-/esm.sh/react@17.0.2`
 */
export function toLocalPath(url: string): string {
  if (util.isLikelyHttpURL(url)) {
    let { hostname, pathname, port, protocol, search } = new URL(url);
    const isHttp = protocol === "http:";
    if ((isHttp && port === "80") || (protocol === "https:" && port === "443")) {
      port = "";
    }
    return [
      "/-/",
      isHttp && "http_",
      hostname,
      port && "_" + port,
      util.trimSuffix(pathname, "/"),
      search,
    ].filter(Boolean).join("");
  }
  return url;
}

/**
 * restore the remote url from local path.
 * e.g. `/-/esm.sh/react@17.0.2` -> `https://esm.sh/react@17.0.2`
 */
export function restoreUrl(pathname: string): string {
  let [h, ...rest] = pathname.substring(3).split("/");
  let protocol = "https";
  if (h.startsWith("http_")) {
    h = h.substring(5);
    protocol = "http";
  }
  const [host, port] = h.split("_");
  return `${protocol}://${host}${port ? ":" + port : ""}/${rest.join("/")}`;
}

export function globalIt<T>(name: string, fn: () => T): T {
  const cache: T | undefined = Reflect.get(globalThis, name);
  if (cache !== undefined) {
    return cache;
  }
  const ret = fn();
  Reflect.set(globalThis, name, ret);
  return ret;
}
