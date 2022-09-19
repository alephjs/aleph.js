import type { FC, ReactNode } from "react";
import { createElement, isValidElement, StrictMode, Suspense, useContext, useEffect, useMemo, useState } from "react";
import events from "../core/events.ts";
import { FetchError } from "../core/error.ts";
import { redirect } from "../core/redirect.ts";
import type { Route, RouteMeta, RouteModule, Router as IRouter } from "../core/route.ts";
import { matchRoutes } from "../core/route.ts";
import { URLPatternCompat, URLPatternInput } from "../core/url_pattern.ts";
import { ForwardPropsContext, RouterContext, type RouterContextProps } from "./context.ts";
import { DataProvider, type RouteData } from "./data.ts";
import { Err, ErrorBoundary } from "./error.ts";

export type SSRContext = {
  readonly url: URL;
  readonly routeModules: RouteModule[];
  readonly headCollection: string[];
};

export type RouterProps = {
  readonly ssrContext?: SSRContext;
  readonly strictMode?: boolean;
  readonly createPortal?: RouterContextProps["createPortal"];
};

/** The `Router` component for react. */
export const Router: FC<RouterProps> = (props) => {
  const { ssrContext, strictMode, createPortal } = props;
  const [url, setUrl] = useState(() => ssrContext?.url || new URL(window.location?.href));
  const [modules, setModules] = useState(() => ssrContext?.routeModules || loadSSRModulesFromTag());
  const dataCache = useMemo(() => {
    const cache = new Map<string, RouteData>();
    modules.forEach(({ url, data, dataCacheTtl }) => {
      const dataUrl = url.pathname + url.search;
      if (data instanceof Promise) {
        cache.set(url.href, { data: prefetchRouteData(cache, dataUrl, true) });
      } else {
        cache.set(dataUrl, {
          data,
          dataCacheTtl,
          dataExpires: Date.now() + (dataCacheTtl || 1) * 1000,
        });
      }
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
    const { body } = window.document;
    const router = loadRouterFromTag();
    const buildId = body.getAttribute("data-build-id");

    // prefetch module using `<link rel="modulepreload" href="...">`
    const onmoduleprefetch = (e: Record<string, unknown>) => {
      const pageUrl = new URL(e.href as string, location.href);
      const matches = matchRoutes(pageUrl, router);
      matches.map(([_, meta]) => {
        const { filename } = meta;
        try {
          __aleph.getRouteModule(filename);
        } catch (_e) {
          const link = document.createElement("link");
          let href = meta.filename.slice(1);
          if (buildId) {
            href += `?v=${buildId}`;
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
      const matches = matchRoutes(url, router);
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
          exports: await __aleph.importRouteModule(filename),
        };
        const dataUrl = rmod.url.pathname + rmod.url.search;
        const dataConfig = rmod.exports.data as undefined | Record<string, boolean>;
        rmod.withData = Boolean(dataConfig?.get || dataConfig?.GET);
        if (rmod.withData && !dataCache.has(dataUrl)) {
          await prefetchRouteData(dataCache, dataUrl, dataConfig?.defer);
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
            clearLoadingBar = null;
            loadingBarEl.remove();
          }, (moveOutTime + fadeOutTime) * 1000);
          clearLoadingBar = () => {
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
        if (pathname === "_app" || pathname === "_404") {
          router[pathname] = route;
        }
        router.routes.push(route);
      }
    };

    // update route record when removing a route file
    const onhmrremove = (e: Record<string, unknown>) => {
      const route = router.routes.find((v) => v[1].filename === e.specifier);
      const pathname = (route?.[1].pattern.pathname)?.slice(1);
      if (pathname === "_app" || pathname === "_404") {
        router[pathname] = undefined;
      }
      router.routes = router.routes.filter((v) => v[1].filename != e.specifier);
      onpopstate({ type: "popstate" });
    };

    addEventListener("popstate", onpopstate as unknown as EventListener);
    events.on("popstate", onpopstate);
    events.on("moduleprefetch", onmoduleprefetch);
    events.on("hmr:create", onhmrcreate);
    events.on("hmr:remove", onhmrremove);
    events.emit("routerready", { type: "routerready" });

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
    return createElement(Err, { error: { status: 404, message: "page not found" }, fullscreen: true });
  }

  const el = createElement(
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
  if (strictMode) {
    return createElement(StrictMode, {}, el);
  }
  return el;
};

type RouteRootProps = {
  modules: RouteModule[];
  dataCache: Map<string, RouteData>;
  ssrContext?: SSRContext;
};

const RouteRoot: FC<RouteRootProps> = ({ modules, dataCache, ssrContext }) => {
  const { url, exports, withData } = modules[0];
  const dataUrl = url.pathname + url.search;
  let el: ReactNode;

  if (typeof exports.default === "function") {
    el = createElement(
      exports.default as FC,
      null,
      modules.length > 1 && createElement(
        RouteRoot,
        { modules: modules.slice(1), dataCache, ssrContext },
      ),
    );
    if (withData) {
      const fallback = exports.fallback || exports.Fallback;
      el = createElement(
        Suspense,
        {
          fallback: (
            typeof fallback === "function" ? createElement(fallback as FC) : (
              typeof fallback === "object" && isValidElement(fallback) ? fallback : null
            )
          ),
        },
        createElement(
          DataProvider,
          {
            dataCache,
            dataUrl: dataUrl,
            key: dataUrl,
          },
          el,
        ),
      );
    }
  } else {
    el = createElement(Err, {
      error: { status: 500, message: "missing default export as a valid React component" },
    });
  }

  return createElement(ErrorBoundary, { Handler: Err }, el);
};

/** The `App` component alias to the `Router` in `StrictMode` mode. */
export const App: FC<Omit<RouterProps, "strictMode">> = (props) => {
  return createElement(Router, { ...props, strictMode: true });
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

function loadRouterFromTag(): IRouter {
  const el = window.document?.getElementById("router-manifest");
  if (el) {
    try {
      const manifest = JSON.parse(el.innerText);
      if (Array.isArray(manifest.routes)) {
        let _app: Route | undefined = undefined;
        let _404: Route | undefined = undefined;
        const routes = manifest.routes.map((meta: RouteMeta) => {
          const { pattern } = meta;
          const route: Route = [new URLPatternCompat(pattern), meta];
          if (pattern.pathname === "/_app") {
            _app = route;
          } else if (pattern.pathname === "/_404") {
            _404 = route;
          }
          return route;
        });
        return { routes, prefix: manifest.prefix, _app, _404 };
      }
    } catch (e) {
      throw new Error(`loadRouteConfigFromTag: ${e.message}`);
    }
  }
  return { routes: [], prefix: "" };
}

// prefetch route data
async function prefetchRouteData(dataCache: Map<string, RouteData>, dataUrl: string, dataDefer?: boolean) {
  const rd: RouteData = {};
  const fetchData = async () => {
    const res = await fetch(dataUrl + (dataUrl.includes("?") ? "&" : "?") + "_data_");
    if (!res.ok) {
      const err = await FetchError.fromResponse(res);
      const details = err.details as { redirect?: { location: string } };
      if (err.status === 501 && typeof details.redirect?.location === "string") {
        location.href = details.redirect?.location;
        return;
      }
      return err;
    }
    try {
      const data = await res.json();
      const cc = res.headers.get("Cache-Control");
      rd.dataCacheTtl = cc?.includes("max-age=") ? parseInt(cc.split("max-age=")[1]) : undefined;
      rd.dataExpires = Date.now() + (rd.dataCacheTtl || 1) * 1000;
      return data;
    } catch (_e) {
      return new Error("Data must be valid JSON");
    }
  };
  if (dataDefer) {
    rd.data = fetchData;
  } else {
    rd.data = await fetchData();
  }
  dataCache.set(dataUrl, rd);
}

function loadSSRModulesFromTag(): RouteModule[] {
  const el = window.document?.getElementById("ssr-data");
  if (el) {
    try {
      const data = JSON.parse(el.innerText);
      if (Array.isArray(data)) {
        let deferedData: Record<string, unknown> | null | undefined = undefined;
        return data.map(({ url, filename, dataDefered, ...rest }) => {
          const mod = __aleph.getRouteModule(filename);
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
            } else {
              rest.data = Promise.resolve(null);
            }
          }
          if (rest.error) {
            rest.data = new FetchError(500, rest.error.message, { stack: rest.error.stack });
            rest.error = undefined;
          }
          return <RouteModule> {
            url: new URL(url, location.href),
            filename,
            exports: mod,
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

let clearLoadingBar: CallableFunction | null = null;

function getLoadingBarEl(): HTMLDivElement {
  if (typeof clearLoadingBar === "function") {
    clearLoadingBar();
    clearLoadingBar = null;
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
