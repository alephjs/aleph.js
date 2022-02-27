import type { Route, RouteMeta } from "../server/types.ts";
import { createStaticURLPatternResult, type URLPatternResult } from "./url.ts";
import util from "./util.ts";

export const builtinModuleExts = ["tsx", "jsx", "ts", "mts", "js", "mjs"];

export function matchRoute(url: URL, routes: Route[]): [ret: URLPatternResult, route: RouteMeta][] {
  let { pathname } = url;
  if (pathname !== "/") {
    pathname = util.trimSuffix(url.pathname, "/").toLowerCase();
  }
  const matches: [ret: URLPatternResult, route: RouteMeta][] = [];
  if (routes.length > 0) {
    routes.forEach(([pattern, meta]) => {
      const ret = pattern.exec({ host: url.host, pathname });
      if (ret) {
        matches.push([ret, meta]);
        if (meta.nesting && meta.pattern.pathname !== "/_app") {
          for (const [p, m] of routes) {
            const ret = p.exec({ host: url.host, pathname: pathname + "/index" });
            if (ret) {
              matches.push([ret, m]);
              break;
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
      if (matches[0][0].pathname.input !== "/_app") {
        for (const [_, meta] of routes) {
          if (meta.pattern.pathname === "/_app") {
            matches.unshift([createStaticURLPatternResult(url.host, "/_app"), meta]);
            break;
          }
        }
      }
    }
  }
  return matches;
}

/**
 * fix remote url to local path
 * e.g.: https://esm.sh/react@17.0.2?target=es2018 -> /-/esm.sh/react@17.0.2?target=es2018
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
 * store local path to remote url
 * e.g.: /-/esm.sh/react@17.0.2?target=es2018 -> https://esm.sh/react@17.0.2?target=es2018
 */
export function restoreUrl(pathname: string) {
  let [h, ...rest] = pathname.substring(3).split("/");
  let protocol = "https";
  if (h.startsWith("http_")) {
    h = h.substring(5);
    protocol = "http";
  }
  const [host, port] = h.split("_");
  return `${protocol}://${host}${port ? ":" + port : ""}/${rest.join("/")}`;
}
