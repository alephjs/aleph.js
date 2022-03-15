import type { FC, ReactElement, ReactNode } from "react";
import { createElement, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { matchRoutes } from "../../lib/helpers.ts";
import { URLPatternCompat } from "../../lib/url.ts";
import type { RenderModule, Route, RouteMeta, SSRContext } from "../../server/types.ts";
import events from "../core/events.ts";
import { redirect } from "../core/redirect.ts";
import { DataContext, ForwardPropsContext, RouterContext } from "./context.ts";

export type RouterProps = {
  readonly ssrContext?: SSRContext;
};

export const Router: FC<RouterProps> = ({ ssrContext }) => {
  const [url, setUrl] = useState(() => ssrContext?.url || new URL(window.location.href));
  const [modules, setModules] = useState(() => ssrContext?.modules || loadSSRModulesFromTag());
  const dataCache = useMemo(() => {
    const cache = new Map<string, { data?: unknown; dataCacheTtl?: number; dataExpires?: number }>();
    modules.forEach(({ url, data, dataCacheTtl }) => {
      cache.set(url.pathname + url.search, {
        data,
        dataCacheTtl,
        dataExpires: Date.now() + (dataCacheTtl || 1) * 1000,
      });
    });
    return cache;
  }, []);
  const createDataDriver = useCallback((modules: RenderModule[]): ReactElement => {
    const currentModule = modules[0];
    const dataUrl = currentModule.url.pathname + currentModule.url.search;
    return createElement(
      DataContext.Provider,
      {
        value: {
          dataUrl,
          dataCache,
          ssrHeadCollection: ssrContext?.headCollection,
        },
      },
      createElement(
        (currentModule?.defaultExport || E404) as FC,
        null,
        modules.length > 1 ? createDataDriver(modules.slice(1)) : undefined,
      ),
    );
  }, []);
  const dataDirver = useMemo<ReactElement | null>(() => modules.length > 0 ? createDataDriver(modules) : null, [
    modules,
  ]);

  useEffect(() => {
    // remove ssr head elements
    const { head } = window.document;
    Array.from(head.children).forEach((el: Element) => {
      if (el.hasAttribute("ssr")) {
        head.removeChild(el);
      }
    });

    const ROUTE_MODULES = getRouteModules();
    const routes = loadRoutesFromTag();
    const importModule = async ({ filename }: RouteMeta) => {
      const { default: defaultExport, data: withData } = await import(filename.slice(1)); // todo: add version
      ROUTE_MODULES[filename] = { defaultExport, withData };
      return { defaultExport, withData };
    };
    const prefetchData = async (dataUrl: string) => {
      const res = await fetch(dataUrl, { headers: { "X-Fetch-Data": "true" }, redirect: "manual" });
      if (res.status === 404 || res.status === 405) {
        dataCache.set(dataUrl, {});
        return {};
      }
      if (res.status >= 400) {
        const message = await res.text();
        console.warn(`prefetchData: ${res.status} ${message}`);
        return {};
      }
      if (res.status >= 300) {
        const redirectUrl = res.headers.get("Location");
        if (redirectUrl) {
          location.href = redirectUrl;
        }
        return {};
      }
      const data = await res.json();
      const cc = res.headers.get("Cache-Control");
      const dataCacheTtl = cc?.includes("max-age=") ? parseInt(cc.split("max-age=")[1]) : undefined;
      dataCache.set(dataUrl, {
        data,
        dataCacheTtl,
        dataExpires: Date.now() + (dataCacheTtl || 1) * 1000,
      });
      return { data, dataCacheTtl };
    };
    const onmoduleprefetch = (e: Record<string, unknown>) => {
      const pageUrl = new URL(e.href as string, location.href);
      const matches = matchRoutes(pageUrl, routes);
      matches.map(([_, meta]) => {
        const { filename } = meta;
        if (!(filename in ROUTE_MODULES)) {
          const link = document.createElement("link");
          link.setAttribute("rel", "modulepreload");
          link.setAttribute("href", meta.filename.slice(1));
          document.head.appendChild(link);
        }
      });
    };
    const onpopstate = async (e: Record<string, unknown>) => {
      const url = new URL(window.location.href);
      const matches = matchRoutes(url, routes);
      const modules = await Promise.all(matches.map(async ([ret, meta]) => {
        const { filename } = meta;
        const rmod: RenderModule = {
          url: new URL(ret.pathname.input, url.href),
          filename,
        };
        const dataUrl = rmod.url.pathname + rmod.url.search;
        if (filename in ROUTE_MODULES) {
          rmod.defaultExport = ROUTE_MODULES[filename].defaultExport;
        } else {
          const { defaultExport } = await importModule(meta);
          rmod.defaultExport = defaultExport;
        }
        if (dataCache.has(dataUrl)) {
          Object.assign(rmod, dataCache.get(dataUrl));
        } else if (ROUTE_MODULES[filename]?.withData === true) {
          const ret = await prefetchData(dataUrl);
          Object.assign(rmod, ret);
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
    events.on("moduleprefetch", onmoduleprefetch);
    events.emit("routerready", { type: "routerready" });

    // todo: update routes by hmr

    return () => {
      removeEventListener("popstate", onpopstate as unknown as EventListener);
      events.off("popstate", onpopstate);
      events.off("moduleprefetch", onmoduleprefetch);
    };
  }, []);

  return createElement(RouterContext.Provider, { value: { url } }, dataDirver);
};

function E404() {
  return createElement(
    "div",
    { style: { padding: 10, color: "#999" } },
    createElement("strong", null, "404"),
    createElement("small", null, " - "),
    "page not found",
  );
}

export const useRouter = (): { url: URL; redirect: typeof redirect } => {
  const { url } = useContext(RouterContext);
  return { url, redirect };
};

export const useForwardProps = <T = Record<string, unknown>>(): T => {
  const { props } = useContext(ForwardPropsContext);
  return props as T;
};

export const forwardProps = (children?: ReactNode, props: Record<string, unknown> = {}) => {
  if (
    children === null || children === undefined || typeof children === "string" || typeof children === "number" ||
    typeof children === "boolean"
  ) {
    return children;
  }
  return createElement(ForwardPropsContext.Provider, { value: { props } }, children);
};

function loadRoutesFromTag(): Route[] {
  const el = window.document?.getElementById("route-manifest");
  if (el) {
    try {
      const manifest = JSON.parse(el.innerText);
      if (Array.isArray(manifest.routes)) {
        return manifest.routes.map((meta: RouteMeta) => [new URLPatternCompat(meta.pattern), meta]);
      }
    } catch (_e) {
      console.error("loadRoutesFromTag: invalid JSON");
    }
  }
  return [];
}

function loadSSRModulesFromTag(): RenderModule[] {
  const ROUTE_MODULES = getRouteModules();
  const el = window.document?.getElementById("ssr-modules");
  if (el) {
    try {
      const ssrData = JSON.parse(el.innerText);
      if (Array.isArray(ssrData)) {
        return ssrData.map(({ url, module: filename, ...rest }) => {
          return {
            url: new URL(url, location.href),
            filename,
            defaultExport: ROUTE_MODULES[filename].defaultExport,
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

function getRouteModules(): Record<string, { defaultExport?: unknown; withData?: boolean }> {
  // deno-lint-ignore ban-ts-comment
  // @ts-ignore
  return window.__ROUTE_MODULES || (window.__ROUTE_MODULES = {});
}
