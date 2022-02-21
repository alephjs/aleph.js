export default {
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
  appendUrlParams(url: URL, params: Record<string, string>): URL {
    const newUrl = new URL(url);
    for (const [key, value] of Object.entries(params)) {
      newUrl.searchParams.set(key, value);
    }
    return newUrl;
  },
  toHex(buffer: ArrayBuffer) {
    const bytes = new Uint8Array(buffer);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
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
  ): DebouncedFunction<Args, F> {
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

export interface DebouncedFunction<Args extends unknown[], F extends (...args: Args) => void> {
  (this: ThisParameterType<F>, ...args: Parameters<F>): void;
}