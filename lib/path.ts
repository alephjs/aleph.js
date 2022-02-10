import { relative } from "https://deno.land/std@0.125.0/path/mod.ts";
import util from "./util.ts";

const reLocalhostUrl = /^https?:\/\/(localhost|0\.0\.0\.0|127\.0\.0\.1)(\:|\/|$)/;
const builtinModuleExts = ["tsx", "jsx", "ts", "js", "mjs", "mts"];

/** check whether it is a localhost url. */
export function isLocalhostUrl(url: string): boolean {
  return reLocalhostUrl.test(url);
}

/** get the relative path from `from` to `to`. */
export function toRelativePath(from: string, to: string): string {
  const p = relative(from, to).replaceAll("\\", "/");
  if (!p.startsWith(".") && !p.startsWith("/")) {
    return "./" + p;
  }
  return p;
}

/**
 * fix remote url to local
 * e.g.: https://esm.sh/react@17.0.2?target=es2018 -> /-/esm.sh/react@17.0.2?target=es2018
 */
export function toLocalPath(url: string, defaultExtname = "js"): string {
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
      pathname,
      search,
    ].filter(Boolean).join("");
  }
  return url;
}

export { builtinModuleExts };
