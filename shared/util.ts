export const utf8Enc = new TextEncoder();
export const utf8Dec = new TextDecoder();

export function isFilledString(a: unknown): a is string {
  return typeof a === "string" && a.length > 0;
}

// deno-lint-ignore no-explicit-any
export function isFilledArray(a: unknown): a is Array<any> {
  return Array.isArray(a) && a.length > 0;
}

export function isPlainObject<T = Record<string, unknown>>(a: unknown): a is T {
  return a !== null && typeof a === "object" && Object.getPrototypeOf(a) === Object.prototype;
}

export function isLikelyHttpURL(s: string): boolean {
  const p = s.slice(0, 8).toLowerCase();
  return p === "https://" || p.slice(0, 7) === "http://";
}

export function trimPrefix(s: string, prefix: string): string {
  if (prefix !== "" && s.startsWith(prefix)) {
    return s.slice(prefix.length);
  }
  return s;
}

export function trimSuffix(s: string, suffix: string): string {
  if (suffix !== "" && s.endsWith(suffix)) {
    return s.slice(0, -suffix.length);
  }
  return s;
}

export function pick<T extends Record<string, unknown>, K extends keyof T>(obj: T, ...keys: K[]): Pick<T, K> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in obj) {
      result[key as string] = obj[key];
    }
  }
  return result as Pick<T, K>;
}

export function splitBy(s: string, searchString: string, fromLast = false): [prefix: string, suffix: string] {
  const i = fromLast ? s.lastIndexOf(searchString) : s.indexOf(searchString);
  if (i >= 0) {
    return [s.slice(0, i), s.slice(i + searchString.length)];
  }
  return [s, ""];
}

export function toHex(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacSign(data: string, secret: string, hash = "SHA-256") {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8Enc.encode(secret),
    { name: "HMAC", hash: { name: hash } },
    false,
    ["sign", "verify"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, utf8Enc.encode(data));
  return toHex(signature);
}

export async function computeHash(algorithm: AlgorithmIdentifier, data: string | Uint8Array): Promise<string> {
  return await crypto.subtle.digest(
    algorithm,
    typeof data === "string" ? utf8Enc.encode(data) : data,
  ).then((sum) => toHex(sum));
}

export function prettyBytes(bytes: number) {
  const units = ["", "K", "M", "G", "T", "P", "E"];
  const exp = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${Math.round(bytes * 100 / Math.pow(1024, exp)) / 100}${units[exp]}B`;
}

export function splitPath(path: string): string[] {
  return path
    .split(/[\/\\]+/g)
    .filter((p) => p !== "" && p !== ".")
    .reduce((slice, p) => {
      if (p === "..") {
        slice.pop();
      } else {
        slice.push(p);
      }
      return slice;
    }, [] as Array<string>);
}

export function cleanPath(path: string): string {
  return "/" + splitPath(path).join("/");
}
