import util from "./util.ts";

export const builtinModuleExts = ["tsx", "ts", "mts", "jsx", "js", "mjs"];

export class FetchError extends Error {
  constructor(
    public status: number,
    public details: Record<string, unknown>,
    message: string,
    opts?: ErrorOptions,
  ) {
    super(message, opts);
  }

  static async fromResponse(res: Response): Promise<FetchError> {
    let message = res.statusText;
    let details: Record<string, unknown> = {};
    if (res.headers.get("content-type")?.startsWith("application/json")) {
      details = await res.json();
      if (typeof details.message === "string") {
        message = details.message;
      }
    } else {
      message = await res.text();
    }
    return new FetchError(res.status, details, message);
  }
}

/**
 * fix remote url to local path.
 * e.g. `https://esm.sh/react@17.0.2?dev` -> `/-/esm.sh/react@17.0.2?dev`
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
