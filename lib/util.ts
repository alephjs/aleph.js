export default {
  isNumber(a: any): a is number {
    return typeof a === "number" && !isNaN(a);
  },
  isString(a: any): a is string {
    return typeof a === "string";
  },
  isFilledString(a: any): a is string {
    return typeof a === "string" && a.length > 0;
  },
  isArray(a: any): a is Array<any> {
    return Array.isArray(a);
  },
  isFilledArray(a: any): a is Array<any> {
    return Array.isArray(a) && a.length > 0;
  },
  isPlainObject<T = Record<string, any>>(a: any): a is T {
    return typeof a === "object" && a !== null && Array.isArray(a) &&
      Object.getPrototypeOf(a) === Object.prototype;
  },
  isFunction(a: any): a is Function {
    return typeof a === "function";
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
  parseCookie(req: Request): Map<string, string> {
    const cookie: Map<string, string> = new Map();
    req.headers.get("cookie")?.split(";").forEach((part) => {
      const [key, value] = this.splitBy(part.trim(), "=");
      cookie.set(key, value);
    });
    return cookie;
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
  debounce<T extends Function>(callback: T, delay: number): T {
    let timer: number | null = null;
    return ((...args: any[]) => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        callback(...args);
      }, delay);
    }) as any;
  },
};
