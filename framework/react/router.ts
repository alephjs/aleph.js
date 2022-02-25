import type { FC, ReactElement, ReactNode } from "https://esm.sh/react@17.0.2";
import { createElement, useCallback, useContext, useEffect, useMemo, useState } from "https://esm.sh/react@17.0.2";
import util from "../../lib/util.ts";
import type { SSRContext } from "../../server/types.ts";
import events from "../core/events.ts";
import { redirect } from "../core/redirect.ts";
import RouterContext from "./context.ts";
import { E404Page } from "./error.ts";

class URLPatternCompat {
  pattern: Record<string, unknown>;

  static execPathname(
    patternPathname: string,
    pathname: string,
  ): null | { pathname: { input: string; groups: Record<string, string> } } {
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

  constructor(pattern: { host?: string; pathname: string }) {
    if ("URLPattern" in window) {
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

  exec(
    input: { host: string; pathname: string },
  ): null | { pathname: { input: string; groups: Record<string, string> } } {
    const { pattern } = this;
    if (typeof pattern.exec === "function") {
      return pattern.exec(input);
    }
    if (util.isFilledString(pattern.host) && pattern.host !== input.host) {
      return null;
    }
    if (util.isFilledString(pattern.pathname)) {
      return URLPatternCompat.execPathname(pattern.pathname, input.pathname);
    }
    return null;
  }
}

export type RouterProps = {
  readonly ssrContext?: SSRContext;
};

export const Router: FC<RouterProps> = ({ ssrContext }) => {
  // deno-lint-ignore ban-ts-comment
  // @ts-ignore
  const ssrModules = window.__SSR_MODULES || (window.__SSR_MODULES = {});
  const dataCache = useMemo(() => {
    const cache = new Map();
    const data = ssrContext
      ? ssrContext.modules.map(({ url, data, dataCacheTtl }) => ({
        url: url.pathname + url.search,
        data,
        dataCacheTtl,
      }))
      : loadSSRDataFromTag();
    data?.forEach(({ url, data, dataCacheTtl }) => {
      cache.set(url, { data, dataCacheTtl });
    });
    return cache;
  }, []);
  const createContextElement = useCallback((url: URL, component: FC, child?: ReactNode) => {
    return createElement(
      RouterContext.Provider,
      {
        value: { url, dataCache, ssrHeadCollection: ssrContext?.headCollection },
      },
      createElement(component, null, child),
    );
  }, []);
  const [url, setUrl] = useState(() => ssrContext?.url || new URL(window.location.href));
  const [routes, _setRoutes] = useState<[pattern: URLPatternCompat, filename: string, isNest: boolean][]>(() => {
    const routesDataEl = window.document?.getElementById("aleph-routes");
    if (routesDataEl) {
      try {
        const routes = JSON.parse(routesDataEl.innerText);
        if (Array.isArray(routes)) {
          return routes.map(({ pattern, filename }) => {
            const isNest = !util.splitBy(filename, ".", true)[0].endsWith("/index") &&
              routes.findIndex((rr) =>
                  rr.pattern.host === pattern.host && rr.pattern.pathname !== pattern.pathname &&
                  rr.pattern.pathname.startsWith(pattern.pathname)
                ) !== -1;
            return [new URLPatternCompat(pattern), filename, isNest];
          });
        }
      } catch (_e) {
        console.error("init routes: invalid JSON");
      }
    }
    return [];
  });

  useEffect(() => {
    // remove ssr head elements
    const { head } = window.document;
    Array.from(head.children).forEach((el: Element) => {
      if (el.hasAttribute("ssr")) {
        head.removeChild(el);
      }
    });

    // todo: update routes

    const onpopstate = async (e: Record<string, unknown>) => {
      const modules: [dataUrl: string, filename: string][] = [];
      for (const [pattern, filename] of routes) {
        let ret = pattern.exec({ host: location.host, pathname: "/_app" });
        if (!ret) {
          ret = pattern.exec({ host: location.host, pathname: location.pathname });
        }
        if (ret) {
          const url = util.appendUrlParams(new URL(location.href), ret.pathname.groups);
          modules.push([url.pathname + url.search, filename]);
        }
      }
      if (modules.length > 0) {
        await Promise.all(modules.map(async ([dataUrl, filename]) => {
          if (filename in ssrModules) {
            return;
          }
          const mod = await import(filename.slice(1)); // todo: add version
          if (typeof mod.default === "function") {
            ssrModules[filename] = mod.default;
            if (mod.data === true) {
              const res = await fetch(dataUrl, { headers: { "X-Fetch-Data": "true" } });
              const data = await res.json();
              const cc = res.headers.get("Cache-Control");
              const dataCacheTtl = cc && cc.includes("max-age")
                ? Date.now() + parseInt(cc.split("=")[1]) * 1000
                : undefined;
              dataCache.set(dataUrl, { data, dataCacheTtl });
            }
          }
        }));
      }
      setUrl(new URL(location.href));
      if (e.resetScroll) {
        window.scrollTo(0, 0);
      }
    };
    addEventListener("popstate", onpopstate as unknown as EventListener);
    events.on("popstate", onpopstate);
    events.emit("routerready", { type: "routerready" });

    return () => {
      removeEventListener("popstate", onpopstate as unknown as EventListener);
      events.off("popstate", onpopstate);
    };
  }, [routes]);

  return useMemo<ReactElement>(
    () => {
      if (ssrContext) {
        const component = ssrContext.modules.find((i) => i.url.pathname === url.pathname)?.defaultExport as FC;
        if (component) {
          return createContextElement(ssrContext.url, component);
        }
        return createContextElement(ssrContext.url, E404Page);
      }
      const route = routes.find(([pattern]) => pattern.test(location));
      if (route) {
        const mod = ssrModules[route[1]];
        if (mod) {
          return mod.default;
        }
      }
      return createContextElement(new URL(location.href), E404Page);
    },
    [routes, url],
  );
};

export const useRouter = (): { url: URL; redirect: typeof redirect } => {
  const { url } = useContext(RouterContext);
  return { url, redirect };
};

function loadSSRDataFromTag(): { url: string; data?: unknown; dataCacheTtl?: number }[] | undefined {
  const ssrDataEl = self.document?.getElementById("aleph-ssr-data");
  if (ssrDataEl) {
    try {
      const ssrData = JSON.parse(ssrDataEl.innerText);
      return ssrData;
    } catch (_e) {
      console.error("ssr-data: invalid JSON");
    }
  }
  return undefined;
}
