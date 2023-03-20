import type { FC, ReactNode } from "react";
import { createElement, isValidElement, StrictMode, Suspense, useContext, useEffect, useMemo, useState } from "react";
import type { SSRContext } from "../../server/types.ts";
import { redirect } from "../core/redirect.ts";
import type { CSRContext, RouteModule } from "../core/router.ts";
import { fetchRouteData, listenRouter } from "../core/router.ts";
import { ForwardPropsContext, RouterContext, type RouterContextProps } from "./context.ts";
import { DataProvider, type RouteData } from "./data.ts";
import { Err, ErrorBoundary } from "./error.ts";

export type RouterProps = {
  readonly csrContext?: CSRContext;
  readonly ssrContext?: SSRContext;
  readonly createPortal?: RouterContextProps["createPortal"];
};

/** The `Router` component for react. */
export const Router: FC<RouterProps> = (props) => {
  const { csrContext, ssrContext, createPortal } = props;
  const [url, setUrl] = useState(() => ssrContext?.url ?? new URL(window.location?.href));
  const [modules, setModules] = useState(() => ssrContext?.modules ?? csrContext?.modules ?? []);
  const dataCache = useMemo(() => {
    const cache = new Map<string, RouteData>();
    modules.forEach(({ url, data, dataCacheTtl }) => {
      const dataUrl = url.pathname + url.search;
      if (data instanceof Promise) {
        cache.set(url.href, { data: fetchRouteData(cache, dataUrl, true) });
      } else {
        cache.set(dataUrl, {
          data,
          dataCacheTtl,
          dataExpires: Date.now() + (dataCacheTtl ?? 0) * 1000,
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
    const dispose = listenRouter(dataCache, (url, modules) => {
      setUrl(url);
      setModules(modules);
    });
    return dispose;
  }, []);

  if (modules.length === 0) {
    return createElement(Err, { error: { status: 404, message: "page not found" }, fullscreen: true });
  }

  const value = {
    url,
    params,
    e404: modules[modules.length - 1].url.pathname === "/_404" ? true : undefined,
    ssrHeadCollection: ssrContext?.headCollection,
    createPortal,
  };
  return createElement(
    RouterContext.Provider,
    { value },
    createElement(
      RouteRoot,
      { modules, dataCache },
    ),
  );
};

type RouteRootProps = {
  modules: RouteModule[];
  dataCache: Map<string, RouteData>;
};

const RouteRoot: FC<RouteRootProps> = ({ modules, dataCache }) => {
  const { url, exports, withData } = modules[0];
  const dataUrl = url.pathname + url.search;
  let el: ReactNode;

  if (typeof exports.default === "function") {
    el = createElement(
      exports.default as FC,
      null,
      modules.length > 1 && createElement(
        RouteRoot,
        { modules: modules.slice(1), dataCache },
      ),
    );
    if (withData) {
      const fallback = exports.Loading ?? exports.Fallback ?? exports.fallback;
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
export const App: FC<RouterProps> = (props) => {
  return createElement(StrictMode, null, createElement(Router, { ...props }));
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
