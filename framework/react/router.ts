import type { FC, ReactElement } from "https://esm.sh/react@17.0.2";
import { createElement, useCallback, useContext, useEffect, useMemo, useState } from "https://esm.sh/react@17.0.2";
import { matchRoutes } from "../../lib/helpers.ts";
import { URLPatternCompat } from "../../lib/url.ts";
import util from "../../lib/util.ts";
import type { RenderModule, Route, RouteMeta, SSRContext } from "../../server/types.ts";
import events from "../core/events.ts";
import { redirect } from "../core/redirect.ts";
import RouterContext from "./context.ts";
import { E404Page } from "./error.ts";

export type RouterProps = {
  readonly ssrContext?: SSRContext;
};

export const Router: FC<RouterProps> = ({ ssrContext }) => {
  const [url, setUrl] = useState(() => ssrContext?.url || new URL(window.location.href));
  const [modules, setModules] = useState(() => ssrContext?.modules || loadSSRModulesFromTag());
  const dataCache = useMemo(() => {
    const cache = new Map<string, { data?: unknown; dataCacheTtl?: number }>();
    modules.forEach(({ url, data, dataCacheTtl }) => {
      cache.set(url.pathname + url.search, { data, dataCacheTtl });
    });
    return cache;
  }, []);
  const createContextElement = useCallback((url: URL, modules: RenderModule[]): ReactElement => {
    const currentModule = modules[0] as RenderModule | undefined;
    const dataUrl = currentModule?.url || url;
    const ctxValue = {
      url,
      dataUrl: dataUrl.pathname + dataUrl.search,
      dataCache,
      ssrHeadCollection: ssrContext?.headCollection,
    };
    return createElement(
      RouterContext.Provider,
      { value: ctxValue },
      createElement(
        (currentModule?.defaultExport || E404Page) as FC,
        null,
        modules.length > 1 ? createContextElement(url, modules.slice(1)) : undefined,
      ),
    );
  }, []);

  useEffect(() => {
    // remove ssr head elements
    const { head } = window.document;
    Array.from(head.children).forEach((el: Element) => {
      if (el.hasAttribute("ssr")) {
        head.removeChild(el);
      }
    });

    const { routes } = loadRouteManifestFromTag();
    const onpopstate = async (e: Record<string, unknown>) => {
      // deno-lint-ignore ban-ts-comment
      // @ts-ignore
      const ROUTE_MODULES: Record<string, unknown> = window.__ROUTE_MODULES || (window.__ROUTE_MODULES = {});
      const url = new URL(window.location.href);
      const matches = matchRoutes(url, routes);
      const modules = await Promise.all(matches.map(async ([ret, { filename }]) => {
        const rmod: RenderModule = {
          url: util.appendUrlParams(new URL(ret.pathname.input, url.href), ret.pathname.groups),
          filename: filename,
        };
        const dataUrl = rmod.url.pathname + rmod.url.search;
        if (filename in ROUTE_MODULES) {
          rmod.defaultExport = ROUTE_MODULES[filename];
          Object.assign(rmod, dataCache.get(dataUrl));
        } else {
          const { default: defaultExport, data: withData } = await import(filename.slice(1)); // todo: add version
          if (defaultExport) {
            ROUTE_MODULES[filename] = defaultExport;
            rmod.defaultExport = defaultExport;
            if (withData === true) {
              const res = await fetch(dataUrl, { headers: { "X-Fetch-Data": "true" } });
              const data = await res.json();
              const cc = res.headers.get("Cache-Control");
              const dataCacheTtl = cc?.includes("max-age") ? Date.now() + parseInt(cc.split("=")[1]) * 1000 : undefined;
              dataCache.set(dataUrl, { data, dataCacheTtl });
              Object.assign(rmod, { data, dataCacheTtl });
            }
          }
        }
        return rmod;
      }));
      setModules(modules);
      setUrl(url);
      if (e.resetScroll) {
        window.scrollTo(0, 0);
      }
    };

    addEventListener("popstate", onpopstate as unknown as EventListener);
    events.on("popstate", onpopstate);
    events.emit("routerready", { type: "routerready" });

    // todo: update routes by hmr

    return () => {
      removeEventListener("popstate", onpopstate as unknown as EventListener);
      events.off("popstate", onpopstate);
    };
  }, []);

  return useMemo<ReactElement>(() => createContextElement(url, modules), [url, modules]);
};

export const useRouter = (): { url: URL; redirect: typeof redirect } => {
  const { url } = useContext(RouterContext);
  return { url, redirect };
};

function loadRouteManifestFromTag(): { routes: Route[] } {
  const el = window.document?.getElementById("route-manifest");
  if (el) {
    try {
      const manifest = JSON.parse(el.innerText);
      if (Array.isArray(manifest.routes)) {
        return {
          routes: manifest.routes.map((meta: RouteMeta) => [new URLPatternCompat(meta.pattern), meta]),
        };
      }
    } catch (_e) {
      console.error("loadRouteManifestFromTag: invalid JSON");
    }
  }
  return { routes: [] };
}

function loadSSRModulesFromTag(): RenderModule[] {
  // deno-lint-ignore ban-ts-comment
  // @ts-ignore
  const ROUTE_MODULES: Record<string, unknown> = window.__ROUTE_MODULES || (window.__ROUTE_MODULES = {});
  const el = window.document?.getElementById("ssr-modules");
  if (el) {
    try {
      const ssrData = JSON.parse(el.innerText);
      if (Array.isArray(ssrData)) {
        return ssrData.map(({ url, module: filename, ...rest }) => {
          return {
            url: new URL(url, location.href),
            filename,
            defaultExport: ROUTE_MODULES[filename],
            ...rest,
          };
        });
      }
    } catch (_e) {
      console.error("loadSSRModulesFromTag: invalid JSON");
    }
  }
  return [];
}
