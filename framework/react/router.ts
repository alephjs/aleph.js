import type { FC, ReactNode } from "react";
import { createElement, StrictMode, useContext, useEffect, useMemo, useState } from "react";
import events from "../core/events.ts";
import FetchError from "../core/fetch_error.ts";
import { redirect } from "../core/redirect.ts";
import type { Route, RouteMeta, RouteModule, RouteRecord } from "../core/route.ts";
import { matchRoutes } from "../core/route.ts";
import { URLPatternCompat } from "../core/url_pattern.ts";
import { ForwardPropsContext, RouterContext, type RouterContextProps } from "./context.ts";
import { DataProvider, type RouteData } from "./data.ts";
import { Err, ErrorBoundary } from "./error.ts";

export type SSRContext = {
  readonly url: URL;
  readonly routeModules: RouteModule[];
  readonly headCollection: string[];
  readonly errorBoundaryHandler?: CallableFunction;
  readonly suspense: boolean;
};

export type RouterProps = {
  readonly ssrContext?: SSRContext;
  readonly suspense?: boolean;
  readonly createPortal?: RouterContextProps["createPortal"];
};

// deno-lint-ignore no-explicit-any
const global = window as any;

/** The `Router` component for react. */
export const Router: FC<RouterProps> = ({ ssrContext, suspense, createPortal }) => {
  const [url, setUrl] = useState(() => ssrContext?.url || new URL(window.location?.href));
  const [modules, setModules] = useState(() => ssrContext?.routeModules || loadSSRModulesFromTag());
  const dataCache = useMemo(() => {
    const cache = new Map<string, RouteData>();
    modules.forEach(({ url, data, dataCacheTtl }) => {
      cache.set(url.pathname + url.search, {
        data,
        dataCacheTtl,
        dataExpires: Date.now() + (dataCacheTtl || 1) * 1000,
      });
    });
    return cache;
  }, []);
  const params = useMemo(() => {
    const params: Record<string, string> = {};
    modules.forEach((m) => {
      Object.assign(params, m.params);
    });
    return params;
  }, [modules]);

  useEffect(() => {
    // remove ssr head elements
    const { head } = window.document;
    Array.from(head.children).forEach((el: Element) => {
      if (el.hasAttribute("ssr")) {
        head.removeChild(el);
      }
    });

    const routeModules = getRouteModules();
    const routes = loadRoutesFromTag();
    const importModule = async ({ filename }: RouteMeta) => {
      const deployId = document.body.getAttribute("data-deployment-id");
      let url = filename.slice(1);
      if (deployId) {
        url += `?v=${deployId}`;
      }
      const { default: defaultExport, data: withData } = await import(url);
      routeModules[filename] = { defaultExport, withData };
      return { defaultExport, withData };
    };
    const isSuspense = document.body.getAttribute("data-suspense") ?? suspense;
    const prefetchData = async (dataUrl: string) => {
      const rd: RouteData = {};
      const fetchData = async () => {
        const res = await fetch(dataUrl, { headers: { "Accept": "application/json" }, redirect: "manual" });
        if (res.type === "opaqueredirect") {
          location.reload();
          return;
        }
        if (!res.ok) {
          const err = await FetchError.fromResponse(res);
          if (err.status >= 300 && err.status < 400 && typeof err.details.location === "string") {
            location.href = err.details.location;
            location.reload();
            return;
          }
          // clean up data cache
          setTimeout(() => dataCache.delete(dataUrl), 0);
          if (isSuspense) {
            throw err;
          } else {
            // todo: better notify UI
            alert(`Fetch Data: ${err.message}`);
            history.back();
            return;
          }
        }
        try {
          const data = await res.json();
          const cc = res.headers.get("Cache-Control");
          rd.dataCacheTtl = cc?.includes("max-age=") ? parseInt(cc.split("max-age=")[1]) : undefined;
          rd.dataExpires = Date.now() + (rd.dataCacheTtl || 1) * 1000;
          return data;
        } catch (_e) {
          throw new FetchError(500, {}, "Data must be valid JSON");
        }
      };
      if (isSuspense) {
        rd.data = fetchData;
      } else {
        rd.data = await fetchData();
      }
      dataCache.set(dataUrl, rd);
    };
    const onmoduleprefetch = (e: Record<string, unknown>) => {
      const deployId = document.body.getAttribute("data-deployment-id");
      const pageUrl = new URL(e.href as string, location.href);
      const matches = matchRoutes(pageUrl, routes);
      matches.map(([_, meta]) => {
        const { filename } = meta;
        if (!(filename in routeModules)) {
          const link = document.createElement("link");
          let href = meta.filename.slice(1);
          if (deployId) {
            href += `?v=${deployId}`;
          }
          link.setAttribute("rel", "modulepreload");
          link.setAttribute("href", href);
          document.head.appendChild(link);
        }
      });
    };
    const onpopstate = async (e: Record<string, unknown>) => {
      const url = (e.url as URL | undefined) || new URL(window.location.href);
      const matches = matchRoutes(url, routes);
      const loadingBar = getLoadingBar();
      let loading: number | null = setTimeout(() => {
        loading = null;
        loadingBar.style.opacity = "1";
        loadingBar.style.width = "50%";
      }, 300);
      const modules = await Promise.all(matches.map(async ([ret, meta]) => {
        const { filename } = meta;
        const rmod: RouteModule = {
          url: new URL(ret.pathname.input + url.search, url.href),
          params: ret.pathname.groups,
          filename,
        };
        const dataUrl = rmod.url.pathname + rmod.url.search;
        if (filename in routeModules) {
          Object.assign(rmod, routeModules[filename]);
        } else {
          const { defaultExport, withData } = await importModule(meta);
          Object.assign(rmod, { defaultExport, withData });
        }
        if (!dataCache.has(dataUrl) && routeModules[filename]?.withData === true) {
          rmod.withData = true;
          await prefetchData(dataUrl);
        }
        return rmod;
      }));
      setModules(modules);
      setUrl(url);
      setTimeout(() => {
        if (loading) {
          clearTimeout(loading);
          loadingBar.remove();
        } else {
          const moveOutTime = 0.7;
          const fadeOutTime = 0.3;
          const t1 = setTimeout(() => {
            loadingBar.style.opacity = "0";
          }, moveOutTime * 1000);
          const t2 = setTimeout(() => {
            global.__loading_bar_cleanup = null;
            loadingBar.remove();
          }, (moveOutTime + fadeOutTime) * 1000);
          global.__loading_bar_cleanup = () => {
            clearTimeout(t1);
            clearTimeout(t2);
          };
          loadingBar.style.transition = `opacity ${fadeOutTime}s ease-out, width ${moveOutTime}s ease-in-out`;
          setTimeout(() => {
            loadingBar.style.width = "100%";
          }, 0);
        }
      }, 0);
      if (e.url) {
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

  if (modules.length === 0) {
    return createElement(Err, { status: 404, message: "page not found" });
  }

  return createElement(
    RouterContext.Provider,
    {
      value: {
        url,
        params,
        e404: modules[modules.length - 1].url.pathname === "/_404" ? true : undefined,
        ssrHeadCollection: ssrContext?.headCollection,
        createPortal,
      },
    },
    createElement(RouteRoot, { modules, dataCache, ssrContext }),
  );
};

const RouteRoot: FC<{ modules: RouteModule[]; dataCache: Map<string, RouteData>; ssrContext?: SSRContext }> = (
  { modules, dataCache, ssrContext },
) => {
  const { url, defaultExport, withData } = modules[0];
  const dataUrl = url.pathname + url.search;
  const errorHandler: FC<{ error: Error }> = ssrContext?.errorBoundaryHandler ?? global.__ERROR_BOUNDARY_HANDLER ?? Err;
  const el = typeof defaultExport === "function"
    ? createElement(
      defaultExport as FC,
      null,
      modules.length > 1 && createElement(
        RouteRoot,
        { modules: modules.slice(1), dataCache, ssrContext },
      ),
    )
    : createElement(Err, {
      status: 400,
      message: "missing default export as a valid React component",
    });

  return createElement(
    ErrorBoundary,
    { Handler: errorHandler },
    withData
      ? createElement(
        DataProvider,
        {
          dataCache,
          dataUrl: dataUrl,
          key: dataUrl,
        },
        el,
      )
      : el,
  );
};

/** The `App` component alias to the `Router` in `StrictMode` mode. */
export const App: FC<RouterProps> = (props) => {
  return createElement(
    StrictMode,
    null,
    createElement(Router, props),
  );
};

export const useRouter = (): { url: URL; params: Record<string, string>; redirect: typeof redirect } => {
  const { url, params } = useContext(RouterContext);
  return { url, params, redirect };
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

export const useForwardProps = <T = Record<string, unknown>>(): T => {
  const { props } = useContext(ForwardPropsContext);
  return props as T;
};

function loadRoutesFromTag(): RouteRecord {
  const el = window.document?.getElementById("routes-manifest");
  if (el) {
    try {
      const manifest = JSON.parse(el.innerText);
      if (Array.isArray(manifest.routes)) {
        let _app: Route | undefined = undefined;
        let _404: Route | undefined = undefined;
        let _error: Route | undefined = undefined;
        const routes = manifest.routes.map((meta: RouteMeta) => {
          const { pattern } = meta;
          const route: Route = [new URLPatternCompat(pattern), meta];
          if (pattern.pathname === "/_app") {
            _app = route;
          } else if (pattern.pathname === "/_404") {
            _404 = route;
          } else if (pattern.pathname === "/_error") {
            _error = route;
          }
          return route;
        });
        return { routes, _app, _404, _error };
      }
    } catch (e) {
      throw new Error(`loadRoutesFromTag: ${e.message}`);
    }
  }
  return { routes: [] };
}

function loadSSRModulesFromTag(): RouteModule[] {
  const el = window.document?.getElementById("ssr-modules");
  if (el) {
    try {
      const data = JSON.parse(el.innerText);
      if (Array.isArray(data)) {
        let suspenseData: Record<string, unknown> | null | undefined = undefined;
        const routeModules = getRouteModules();
        return data.map(({ url, filename, suspense, ...rest }) => {
          if (suspense) {
            if (suspenseData === undefined) {
              const el = window.document?.getElementById("suspense-data");
              if (el) {
                suspenseData = JSON.parse(el.innerText);
              } else {
                suspenseData = null;
              }
            }
            if (suspenseData) {
              rest.data = suspenseData[url];
            }
          }
          return {
            url: new URL(url, location.href),
            filename,
            defaultExport: routeModules[filename].defaultExport,
            ...rest,
          };
        });
      }
    } catch (e) {
      throw new Error(`loadSSRModulesFromTag: ${e.message}`);
    }
  }
  return [];
}

function getLoadingBar(): HTMLDivElement {
  if (typeof global.__loading_bar_cleanup === "function") {
    global.__loading_bar_cleanup();
    global.__loading_bar_cleanup = null;
  }
  let bar = (document.getElementById("loading-bar") as HTMLDivElement | null);
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "loading-bar";
    document.body.appendChild(bar);
  }
  Object.assign(bar.style, {
    position: "fixed",
    top: "0",
    left: "0",
    zIndex: "9999",
    width: "0",
    height: "1px",
    opacity: "0",
    background: "rgba(128, 128, 128, 0.9)",
    transition: "opacity 0.6s ease-in, width 3s ease-in",
  });
  return bar;
}

function getRouteModules(): Record<string, { defaultExport?: unknown; withData?: boolean }> {
  return global.__ROUTE_MODULES || (global.__ROUTE_MODULES = {});
}
