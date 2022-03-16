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
    return typeof a === "object" && a !== null && Object.getPrototypeOf(a) === Object.prototype;
  },
  isLikelyHttpURL(s: string): boolean {
    const p = s.slice(0, 8).toLowerCase();
    return p === "https://" || p.slice(0, 7) === "http://";
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
  splitBy(s: string, searchString: string, fromLast = false): [string, string] {
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
  async computeHash(algorithm: AlgorithmIdentifier, data: string | Uint8Array): Promise<string> {
    const sum = await crypto.subtle.digest(
      algorithm,
      typeof data === "string" ? this.utf8TextEncoder.encode(data) : data,
    );
    return this.toHex(sum);
  },
  prettyBytes(bytes: number) {
    const units = ["B", "KB", "MB", "GB", "TB", "PB", "EB"];
    const exp = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${Math.round(bytes * 100 / Math.pow(1024, exp)) / 100}${units[exp]}`;
  },
  splitPath(path: string): string[] {
    return path
      .split(/[\/\\]+/g)
      .map((p) => p.trim())
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
