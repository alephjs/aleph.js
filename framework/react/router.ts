import type { FC, ReactNode } from "react";
import { createElement, isValidElement, StrictMode, Suspense, useContext, useEffect, useMemo, useState } from "react";
import { isPlainObject } from "../../shared/util.ts";
import events from "../core/events.ts";
import { redirect } from "../core/redirect.ts";
import type { Route, RouteModule } from "../core/routes.ts";
import {
  listenHistory,
  loadRouterFromTag,
  loadSSRModulesFromTag,
  matchRoutes,
  prefetchRouteData,
} from "../core/routes.ts";
import { URLPatternCompat, URLPatternInput } from "../core/url_pattern.ts";
import { ForwardPropsContext, RouterContext, type RouterContextProps } from "./context.ts";
import { DataProvider, type RouteData } from "./data.ts";
import { Err, ErrorBoundary } from "./error.ts";

export type SSRContext = {
  readonly url: URL;
  readonly modules: RouteModule[];
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
  const [modules, setModules] = useState(() => ssrContext?.modules || loadSSRModulesFromTag());
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
    const deploymentId = body.getAttribute("data-deployment-id");

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
          if (deploymentId) {
            href += `?v=${deploymentId}`;
          }
          link.setAttribute("rel", "modulepreload");
          link.setAttribute("href", href);
          document.head.appendChild(link);
        }
      });
    };

    // `popstate` event handler
    const onpopstate = async (e: Record<string, unknown>) => {
      const url = (e.url as URL | undefined) ?? new URL(window.location.href);
      const matches = matchRoutes(url, router);
      const modules = await Promise.all(matches.map(async ([ret, meta]) => {
        const { filename } = meta;
        const rmod: RouteModule = {
          url: new URL(ret.pathname.input + url.search, url.href),
          params: ret.pathname.groups,
          filename,
          exports: await __aleph.importRouteModule(filename),
        };
        const dataUrl = rmod.url.pathname + rmod.url.search;
        const dataConfig = rmod.exports.data as Record<string, unknown> | true | undefined;
        const defer = Boolean(isPlainObject(dataConfig) ? dataConfig.defer : undefined);
        rmod.withData = Boolean(
          isPlainObject(dataConfig) ? dataConfig.fetch : dataConfig ?? rmod.exports.GET,
        );
        if (rmod.withData && !dataCache.has(dataUrl)) {
          await prefetchRouteData(dataCache, dataUrl, defer);
        }
        return rmod;
      }));
      setModules(modules);
      setUrl(url);
      window.scrollTo(0, 0);
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

    // listen history change
    const dispose = listenHistory(onpopstate);

    events.on("popstate", onpopstate);
    events.on("moduleprefetch", onmoduleprefetch);
    events.on("hmr:create", onhmrcreate);
    events.on("hmr:remove", onhmrremove);
    events.emit("router", { type: "router" });

    return () => {
      dispose();
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
  redirect: typeof redirect;
  e404?: boolean;
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
