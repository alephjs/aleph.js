import type { Route } from "../server/types.ts";
import { createStaticURLPatternResult, type URLPatternResult } from "./url.ts";
import util from "./util.ts";

export const builtinModuleExts = ["tsx", "jsx", "ts", "mts", "js", "mjs"];

export function matchRoute(url: URL, routes: Route[]): [ret: URLPatternResult, route: Route][] {
  const matches: [ret: URLPatternResult, route: Route][] = [];
  if (routes.length > 0) {
    routes.forEach((route) => {
      const [pattern, _, meta] = route;
      const ret = pattern.exec({ host: url.host, pathname: url.pathname });
      if (ret) {
        matches.push([ret, route]);
        if (meta.nesting && meta.pattern.pathname !== "/_app") {
          for (const route of routes) {
            const ret = route[0].exec({ host: url.host, pathname: url.pathname + "/index" });
            if (ret) {
              matches.push([ret, route]);
              break;
            }
          }
        }
      } else if (meta.nesting) {
        const parts = util.splitPath(url.pathname);
        for (let i = parts.length - 1; i > 0; i--) {
          const pathname = "/" + parts.slice(0, i).join("/");
          const ret = pattern.exec({ host: url.host, pathname });
          if (ret) {
            matches.push([ret, route]);
            break;
          }
        }
      }
    });
    if (matches.filter(([_, route]) => !route[2].nesting).length === 0) {
      for (const route of routes) {
        if (route[2].pattern.pathname === "/_404") {
          matches.push([createStaticURLPatternResult(url.host, "/_404"), route]);
          break;
        }
      }
    }
    if (matches.length > 0) {
      if (matches[0][0].pathname.input !== "/_app") {
        for (const route of routes) {
          if (route[2].pattern.pathname === "/_app") {
            matches.unshift([createStaticURLPatternResult(url.host, "/_app"), route]);
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
