export default {
  utf8TextEncoder: new TextEncoder(),
  utf8TextDecoder: new TextDecoder(),
  isInt(a: unknown): a is number {
    return typeof a === "number" && !Number.isNaN(a) && Number.isInteger(a);
  },
  isUint(a: unknown): a is number {
    return this.isInt(a) && a >= 0;
  },
  isFilledString(a: unknown): a is string {
    return typeof a === "string" && a.length > 0;
  },
  isFilledArray(a: unknown): a is Array<unknown> {
    return Array.isArray(a) && a.length > 0;
  },
  isPlainObject<T = Record<string, unknown>>(a: unknown): a is T {
    return a !== null && typeof a === "object" && Object.getPrototypeOf(a) === Object.prototype;
  },
  isLikelyHttpURL(s: string): boolean {
    const p = s.slice(0, 8).toLowerCase();
    return p === "https://" || p.slice(0, 7) === "http://";
  },
  startsWithAny(str: string, ...prefixs: string[]) {
    for (const prefix of prefixs) {
      if (str.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  },
  endsWithAny(str: string, ...suffixes: string[]) {
    for (const suffix of suffixes) {
      if (str.endsWith(suffix)) {
        return true;
      }
    }
    return false;
  },
  trimPrefix(s: string, prefix: string): string {
    if (prefix !== "" && s.startsWith(prefix)) {
      return s.slice(prefix.length);
    }
    return s;
  },
  trimSuffix(s: string, suffix: string): string {
    if (suffix !== "" && s.endsWith(suffix)) {
      return s.slice(0, -suffix.length);
    }
    return s;
  },
  pick<T extends Record<string, unknown>, K extends keyof T>(obj: T, ...keys: K[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (key in obj) {
        result[key as string] = obj[key];
      }
    }
    return result;
  },
  splitBy(s: string, searchString: string, fromLast = false): [prefix: string, suffix: string] {
    const i = fromLast ? s.lastIndexOf(searchString) : s.indexOf(searchString);
    if (i >= 0) {
      return [s.slice(0, i), s.slice(i + 1)];
    }
    return [s, ""];
  },
  toHex(buffer: ArrayBuffer) {
    const bytes = new Uint8Array(buffer);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  },
  async hmacSign(data: string, secret: string, hash = "SHA-256") {
    const key = await crypto.subtle.importKey(
      "raw",
      this.utf8TextEncoder.encode(secret),
      { name: "HMAC", hash: { name: hash } },
      false,
      ["sign", "verify"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, this.utf8TextEncoder.encode(data));
    return this.toHex(signature);
  },
  computeHash(algorithm: AlgorithmIdentifier, data: string | Uint8Array): Promise<string> {
    return crypto.subtle.digest(
      algorithm,
      typeof data === "string" ? this.utf8TextEncoder.encode(data) : data,
    ).then((sum) => this.toHex(sum));
  },
  prettyBytes(bytes: number) {
    const units = ["", "K", "M", "G", "T", "P", "E"];
    const exp = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${Math.round(bytes * 100 / Math.pow(1024, exp)) / 100}${units[exp]}B`;
  },
  splitPath(path: string): string[] {
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
  },
  cleanPath(path: string): string {
    return "/" + this.splitPath(path).join("/");
  },
  debounce<Args extends unknown[], F extends (...args: Args) => void>(
    fn: F,
    delay: number,
  ): (this: ThisParameterType<F>, ...args: Parameters<F>) => void {
    let timer: number | null;
    function debounced(this: ThisParameterType<F>, ...args: Parameters<F>): void {
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        fn(...args);
      }, delay);
    }
    return debounced;
  },
};
