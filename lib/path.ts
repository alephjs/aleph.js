import util from "./util.ts";

export const builtinModuleExts = ["tsx", "jsx", "ts", "mts", "js", "mjs"];

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
