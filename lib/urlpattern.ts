import util from "./util.ts";

export type URLPatternInput = {
  host?: string;
  pathname: string;
};

export type URLPatternResult = {
  host: { input: string; groups: Record<string, string> };
  pathname: { input: string; groups: Record<string, string> };
};

export class URLPatternCompat {
  pattern: Record<string, unknown>;

  static execPathname(
    patternPathname: string,
    pathname: string,
  ): null | Pick<URLPatternResult, "pathname"> {
    const patternSegments = util.splitPath(patternPathname);
    const segments = util.splitPath(pathname);
    const depth = Math.max(patternSegments.length, segments.length);
    const groups: Record<string, string> = {};

    for (let i = 0; i < depth; i++) {
      const patternSegment = patternSegments[i];
      const segment = segments[i];

      if (segment === undefined || patternSegment === undefined) {
        return null;
      }

      if (patternSegment.startsWith(":") && patternSegment.length > 1) {
        if (patternSegment.endsWith("+") && patternSegment.length > 2 && i === patternSegments.length - 1) {
          groups[patternSegment.slice(1, -1)] = segments.slice(i).map(decodeURIComponent).join("/");
          break;
        }
        groups[patternSegment.slice(1)] = decodeURIComponent(segment);
      } else if (patternSegment !== segment) {
        return null;
      }
    }

    return {
      pathname: {
        input: pathname,
        groups,
      },
    };
  }

  constructor(pattern: URLPatternInput) {
    if ("URLPattern" in globalThis) {
      // deno-lint-ignore ban-ts-comment
      // @ts-ignore
      this.pattern = new URLPattern(pattern);
    } else {
      this.pattern = pattern;
    }
  }

  test(input: { host: string; pathname: string }): boolean {
    const { pattern } = this;
    if (typeof pattern.test === "function") {
      return pattern.test(input);
    }
    if (util.isFilledString(pattern.host) && pattern.host !== input.host) {
      return false;
    }
    if (util.isFilledString(pattern.pathname)) {
      return URLPatternCompat.execPathname(pattern.pathname, input.pathname) !== null;
    }
    return false;
  }

  exec(input: { host: string; pathname: string }): null | URLPatternResult {
    const { pattern } = this;
    if (typeof pattern.exec === "function") {
      return pattern.exec(input);
    }
    if (util.isFilledString(pattern.host) && pattern.host !== input.host) {
      return null;
    }
    if (util.isFilledString(pattern.pathname)) {
      const ret = URLPatternCompat.execPathname(pattern.pathname, input.pathname);
      if (ret) {
        return {
          ...ret,
          host: {
            input: input.host,
            groups: {},
          },
        };
      }
    }
    return null;
  }
}

export function createStaticURLPatternResult(host: string, pathname: string): URLPatternResult {
  return {
    host: { input: host, groups: {} },
    pathname: { input: pathname, groups: {} },
  };
}
