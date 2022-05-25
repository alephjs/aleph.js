import type { FC, ReactNode } from "react";
import { createElement, StrictMode, useContext, useEffect, useMemo, useState } from "react";
import events from "../core/events.ts";
import FetchError from "../core/fetch_error.ts";
import { redirect } from "../core/redirect.ts";
import type { Route, RouteMeta, RouteModule, RouteRecord } from "../core/route.ts";
import { matchRoutes } from "../core/route.ts";
import { URLPatternCompat, URLPatternInput } from "../core/url_pattern.ts";
import { ForwardPropsContext, RouterContext, type RouterContextProps } from "./context.ts";
import { DataProvider, type RouteData } from "./data.ts";
import { Err, ErrorBoundary } from "./error.ts";

export type SSRContext = {
  readonly url: URL;
  readonly routeModules: RouteModule[];
  readonly headCollection: string[];
  readonly errorBoundaryHandler?: CallableFunction;
  readonly dataDefer: boolean;
};

export type RouterProps = {
  readonly ssrContext?: SSRContext;
  readonly dataDefer?: boolean;
  readonly createPortal?: RouterContextProps["createPortal"];
};

// deno-lint-ignore no-explicit-any
const global = window as any;

/** The `Router` component for react. */
export const Router: FC<RouterProps> = ({ ssrContext, dataDefer: dataDeferProp, createPortal }) => {
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
    const { head, body } = window.document;
    const routeModules = getRouteModules();
    const routeRecord = loadRouteRecordFromTag();
    const dataDefer = body.getAttribute("data-defer") ?? dataDeferProp;
    const deployId = body.getAttribute("data-deployment-id");

    // import route module
    const importModule = async ({ filename }: RouteMeta) => {
      let url = filename.slice(1);
      if (deployId) {
        url += `?v=${deployId}`;
      }
      const { default: defaultExport, data, GET } = await import(url);
      const withData = Boolean(data ?? GET);
      routeModules[filename] = { defaultExport, withData };
      return { defaultExport, withData };
    };

    // prefetch route data
    const prefetchRouteData = async (dataUrl: string) => {
      const rd: RouteData = {};
      const fetchData = async () => {
        const res = await fetch(dataUrl, { headers: { "Accept": "application/json" }, redirect: "manual" });
        if (res.type === "opaqueredirect") {
          location.reload();
          return;
        }
        if (!res.ok) {
          const err = await FetchError.fromResponse(res);
          const details = err.details as { redirect?: { location: string } };
          if (err.status === 501 && typeof details.redirect?.location === "string") {
            location.href = details.redirect?.location;
            return;
          }
          // clean up data cache
          setTimeout(() => dataCache.delete(dataUrl), 0);
          if (dataDefer) {
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
          throw new FetchError(500, "Data must be valid JSON");
        }
      };
      if (dataDefer) {
        rd.data = fetchData;
      } else {
        rd.data = await fetchData();
      }
      dataCache.set(dataUrl, rd);
    };

    // prefetch module using `<link rel="modulepreload" href="...">`
    const onmoduleprefetch = (e: Record<string, unknown>) => {
      const pageUrl = new URL(e.href as string, location.href);
      const matches = matchRoutes(pageUrl, routeRecord);
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

    // `popstate` event handler
    const onpopstate = async (e: Record<string, unknown>) => {
      const url = (e.url as URL | undefined) || new URL(window.location.href);
      const matches = matchRoutes(url, routeRecord);
      const loadingBarEl = getLoadingBarEl();
      let loading: number | null = setTimeout(() => {
        loading = null;
        loadingBarEl.style.opacity = "1";
        loadingBarEl.style.width = "50%";
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
          await prefetchRouteData(dataUrl);
        }
        return rmod;
      }));
      setModules(modules);
      setUrl(url);
      setTimeout(() => {
        if (loading) {
          clearTimeout(loading);
          loadingBarEl.remove();
        } else {
          const moveOutTime = 0.7;
          const fadeOutTime = 0.3;
          const t1 = setTimeout(() => {
            loadingBarEl.style.opacity = "0";
          }, moveOutTime * 1000);
          const t2 = setTimeout(() => {
            global.__LOADING_BAR_CLEANUP = null;
            loadingBarEl.remove();
          }, (moveOutTime + fadeOutTime) * 1000);
          global.__LOADING_BAR_CLEANUP = () => {
            clearTimeout(t1);
            clearTimeout(t2);
          };
          loadingBarEl.style.transition = `opacity ${fadeOutTime}s ease-out, width ${moveOutTime}s ease-in-out`;
          setTimeout(() => {
            loadingBarEl.style.width = "100%";
          }, 0);
        }
      }, 0);
      if (e.url) {
        window.scrollTo(0, 0);
      }
    };

    // update route record when creating a new route file
    const onhmrcreate = (e: Record<string, unknown>) => {
      const pattern = e.routePattern as URLPatternInput | undefined;
      if (pattern) {
        const route: Route = [
          new URLPatternCompat(pattern),
          {
            filename: e.specifier as string,
            pattern,
          },
        ];
        const pathname = pattern.pathname.slice(1);
        if (pathname === "_app" || pathname === "_404" || pathname === "_error") {
          routeRecord[pathname] = route;
        }
        routeRecord.routes.push(route);
      }
    };

    // update route record when removing a route file
    const onhmrremove = (e: Record<string, unknown>) => {
      const route = routeRecord.routes.find((v) => v[1].filename === e.specifier);
      const pathname = (route?.[1].pattern.pathname)?.slice(1);
      if (pathname === "_app" || pathname === "_404" || pathname === "_error") {
        routeRecord[pathname] = undefined;
      }
      routeRecord.routes = routeRecord.routes.filter((v) => v[1].filename != e.specifier);
      onpopstate({ type: "popstate" });
    };

    addEventListener("popstate", onpopstate as unknown as EventListener);
    events.on("popstate", onpopstate);
    events.on("moduleprefetch", onmoduleprefetch);
    events.on("hmr:create", onhmrcreate);
    events.on("hmr:remove", onhmrremove);
    events.emit("routerready", { type: "routerready" });

    // remove ssr head elements
    Array.from(head.children).forEach((el: Element) => {
      if (el.hasAttribute("ssr")) {
        head.removeChild(el);
      }
    });

    // clean up
    return () => {
      removeEventListener("popstate", onpopstate as unknown as EventListener);
      events.off("popstate", onpopstate);
      events.off("moduleprefetch", onmoduleprefetch);
      events.off("hmr:create", onhmrcreate);
      events.off("hmr:remove", onhmrremove);
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

export const useRouter = (): {
  url: URL;
  params: Record<string, string>;
  e404?: boolean;
  redirect: typeof redirect;
} => {
  const { url, params, e404 } = useContext(RouterContext);
  return { url, params, e404, redirect };
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

function loadRouteRecordFromTag(): RouteRecord {
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
      throw new Error(`loadRouteRecordFromTag: ${e.message}`);
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
        let deferedData: Record<string, unknown> | null | undefined = undefined;
        const routeModules = getRouteModules();
        return data.map(({ url, filename, dataDefered, ...rest }) => {
          if (dataDefered) {
            if (deferedData === undefined) {
              const el = window.document?.getElementById("defered-data");
              if (el) {
                deferedData = JSON.parse(el.innerText);
              } else {
                deferedData = null;
              }
            }
            if (deferedData) {
              rest.data = deferedData[url];
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

function getRouteModules(): Record<string, { defaultExport?: unknown; withData?: boolean }> {
  return global.__ROUTE_MODULES || (global.__ROUTE_MODULES = {});
}

function getLoadingBarEl(): HTMLDivElement {
  if (typeof global.__LOADING_BAR_CLEANUP === "function") {
    global.__LOADING_BAR_CLEANUP();
    global.__LOADING_BAR_CLEANUP = null;
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
