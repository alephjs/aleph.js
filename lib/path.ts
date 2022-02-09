import { extname, relative } from "https://deno.land/std@0.125.0/path/mod.ts";
import util from "./util.ts";

const reLocalhostUrl =
  /^https?:\/\/(localhost|0\.0\.0\.0|127\.0\.0\.1)(\:|\/|$)/;
const reEndsWithVersion = /@\d+(\.\d+){0,2}(\-[a-z0-9]+(\.[a-z0-9]+)?)?$/;

export const builtinModuleExts = ["tsx", "jsx", "ts", "js", "mjs"];
export const moduleExclude = [
  /(^|\/|\\)\./,
  /\.d\.ts$/i,
  /(\.|_)(test|spec|e2e)\.[a-z]+$/i,
];

/** check whether it is a localhost url. */
export function isLocalhostUrl(url: string): boolean {
  return reLocalhostUrl.test(url);
}

export function trimBuiltinModuleExts(url: string) {
  for (const ext of builtinModuleExts) {
    if (url.endsWith("." + ext)) {
      return url.slice(0, -(ext.length + 1));
    }
  }
  return url;
}

/** get the relative path from `from` to `to`. */
export function toRelativePath(from: string, to: string): string {
  const p = relative(from, to).replaceAll("\\", "/");
  if (!p.startsWith(".") && !p.startsWith("/")) {
    return "./" + p;
  }
  return p;
}

export function toPagePath(url: string): string {
  let pathname = trimBuiltinModuleExts(url);
  if (pathname.startsWith("/pages/")) {
    pathname = util.trimPrefix(pathname, "/pages");
  }
  if (pathname.endsWith("/index")) {
    pathname = util.trimSuffix(pathname, "/index");
  }
  if (pathname === "") {
    pathname = "/";
  }
  return pathname;
}

/**
 * fix remote import url to local
 * https://esm.sh/react.js?bundle -> /-/esm.sh/react.YnVuZGxl.js
 */
export function toLocalPath(url: string): string {
  if (util.isLikelyHttpURL(url)) {
    let { hostname, pathname, port, protocol, search } = new URL(url);
    const isHttp = protocol === "http:";
    if (
      (isHttp && port === "80") || (protocol === "https:" && port === "443")
    ) {
      port = "";
    }
    if (search !== "") {
      const a = util.splitPath(pathname);
      const basename = a.pop()!;
      const realext = extname(basename);
      const ext = realext != "" && !basename.match(reEndsWithVersion)
        ? realext
        : "js";
      const search64 = util.btoaUrl(search.slice(1));
      a.push(util.trimSuffix(basename, ext) + `.${search64}.` + ext);
      pathname = "/" + a.join("/");
    }
    return [
      "/-/",
      isHttp ? "http_" : "",
      hostname,
      port ? "_" + port : "",
      pathname,
    ].join("");
  }
  return util.trimPrefix(url, "file://");
}
