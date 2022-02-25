import type { FC } from "https://esm.sh/react@17.0.2";
import { createElement, useContext, useEffect, useMemo, useState } from "https://esm.sh/react@17.0.2";
import util from "../../lib/util.ts";
import type { SSRContext } from "../../server/types.ts";
import events from "../core/events.ts";
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
  const [url, setUrl] = useState<URL & { _component?: FC }>(() =>
    ssrContext?.url || new URL(globalThis.location?.href || "http://localhost/")
  );
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
  const [routes, _setRoutes] = useState<[pattern: URLPatternCompat, filename: string][]>(() => {
    const routesDataEl = self.document?.getElementById("aleph-routes");
    if (routesDataEl) {
      try {
        const routes = JSON.parse(routesDataEl.innerText);
        if (Array.isArray(routes)) {
          return routes.map((r) => [new URLPatternCompat(r.pattern), r.filename]);
        }
      } catch (_e) {
        console.error("init routes: invalid JSON");
      }
    }
    return [];
  });
  const [app, _setApp] = useState(() => {
    if (ssrContext) {
      return {
        Component: ssrContext.modules.find(({ url }) => url.pathname === "/_app")?.defaultExport as FC | undefined,
      };
    }
    const route = routes.find(([pattern]) => pattern.test({ host: window.location.host, pathname: "/_app" }));
    if (route) {
      const ssrModules = (window as { __ssrModules?: Record<string, Record<string, FC>> }).__ssrModules || {};
      const mod = ssrModules[route[1]];
      if (mod) {
        return { Component: mod.default };
      }
    }
    return {};
  });
  const routeComponent = useMemo<FC>(
    () => {
      if (ssrContext) {
        return ssrContext.modules.find((i) => i.url.pathname === url.pathname)?.defaultExport as FC || E404Page;
      }
      const route = routes.find(([pattern]) => pattern.test({ host: window.location.host, pathname: url.pathname }));
      if (route) {
        const ssrModules = (window as { __ssrModules?: Record<string, Record<string, FC>> }).__ssrModules || {};
        const mod = ssrModules[route[1]];
        if (mod) {
          return mod.default;
        }
      }

      return url._component || E404Page;
    },
    [url, routes],
  );

  useEffect(() => {
    // remove ssr head elements
    const { head } = window.document;
    Array.from(head.children).forEach((el: Element) => {
      if (el.hasAttribute("ssr")) {
        head.removeChild(el);
      }
    });

    // todo: update routes

    const onpopstate = (e: Record<string, unknown>) => {
      const url = new URL(location.href);
      // todo: cacha data
      // todo: load comonent
      setUrl(url);
      if (e.resetScroll) {
        window.scrollTo(0, 0);
      }
    };
    // deno-lint-ignore ban-ts-comment
    // @ts-ignore
    addEventListener("popstate", onpopstate);
    events.on("popstate", onpopstate);
    events.emit("routerready", { type: "routerready" });

    return () => {
      // deno-lint-ignore ban-ts-comment
      // @ts-ignore
      removeEventListener("popstate", onpopstate);
      events.off("popstate", onpopstate);
    };
  }, []);

  const routeEl = createElement(
    RouterContext.Provider,
    {
      value: {
        url,
        setUrl,
        dataCache,
        ssrHeadCollection: ssrContext?.headCollection,
      },
    },
    createElement(routeComponent),
  );

  if (app.Component) {
    return createElement(
      RouterContext.Provider,
      {
        value: {
          url: new URL("/_app", url.href),
          setUrl: () => {},
          dataCache,
          ssrHeadCollection: ssrContext?.headCollection,
        },
      },
      createElement(app.Component, null, routeEl),
    );
  }

  return routeEl;
};

export const useRouter = (): { url: URL } => {
  const { url } = useContext(RouterContext);
  return { url };
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
