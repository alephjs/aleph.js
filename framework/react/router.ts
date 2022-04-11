import type { FC, ReactElement, ReactNode } from "react";
import { Component, createElement, useContext, useEffect, useMemo, useState } from "react";
import { FetchError } from "../../lib/helpers.ts";
import type { Route, RouteMeta, RouteModule } from "../../lib/route.ts";
import { matchRoutes } from "../../lib/route.ts";
import { URLPatternCompat } from "../../lib/urlpattern.ts";
import type { SSRContext } from "../../server/types.ts";
import events from "../core/events.ts";
import { redirect } from "../core/redirect.ts";
import { DataContext, ForwardPropsContext, RouterContext } from "./context.ts";

export type RouterProps = {
  readonly ssrContext?: SSRContext;
};

export const Router: FC<RouterProps> = ({ ssrContext }) => {
  const [url, setUrl] = useState(() => ssrContext?.url || new URL(window.location.href));
  const [modules, setModules] = useState(() => ssrContext?.routeModules || loadSSRModulesFromTag());
  const dataCache = useMemo(() => {
    const cache = new Map<
      string,
      { error?: Error; data?: unknown; dataCacheTtl?: number; dataExpires?: number }
    >();
    modules.forEach(({ url, data, dataCacheTtl, error }) => {
      cache.set(url.pathname + url.search, {
        error,
        data,
        dataCacheTtl,
        dataExpires: Date.now() + (dataCacheTtl || 1) * 1000,
      });
    });
    return cache;
  }, []);
  const createRouteEl = (modules: RouteModule[]): ReactElement => {
    const ErrorBoundaryHandler: undefined | FC<{ error: Error }> = ssrContext?.errorBoundaryModule?.defaultExport ||
      // deno-lint-ignore no-explicit-any
      (window as any).__ERROR_BOUNDARY_HANDLER;
    const currentModule = modules[0];
    const dataUrl = currentModule.url.pathname + currentModule.url.search;
    const el = createElement(
      DataContext.Provider,
      {
        value: {
          dataUrl,
          dataCache,
          ssrHeadCollection: ssrContext?.headCollection,
        },
      },
      typeof currentModule.defaultExport === "function"
        ? createElement(
          currentModule.defaultExport as FC,
          null,
          modules.length > 1 ? createRouteEl(modules.slice(1)) : undefined,
        )
        : createElement(Err, {
          status: 400,
          statusText: "missing default export as a valid React component",
        }),
    );
    if (ErrorBoundaryHandler) {
      return createElement(ErrorBoundary, { Handler: ErrorBoundaryHandler }, el);
    }
    return el;
  };
  const routeEl = useMemo<ReactElement | null>(
    () =>
      modules.length > 0 ? createRouteEl(modules) : createElement(Err, { status: 404, statusText: "page not found" }),
    [modules],
  );

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
      const res = await fetch(dataUrl, { headers: { "Accept": "application/json" }, redirect: "manual" });
      if (res.status === 404 || res.status === 405) {
        dataCache.set(dataUrl, {});
        return {};
      }
      if (res.status >= 400) {
        const error = await FetchError.fromResponse(res);
        dataCache.set(dataUrl, {
          error,
          dataExpires: Date.now() + 1000,
        });
        return {};
      }
      if (res.status >= 300) {
        const redirectUrl = res.headers.get("Location");
        if (redirectUrl) {
          location.href = redirectUrl;
        }
        const error = new FetchError(500, {}, "Missing the `Location` header");
        dataCache.set(dataUrl, {
          error,
          dataExpires: Date.now() + 1000,
        });
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
        const rmod: RouteModule = {
          url: new URL(ret.pathname.input + url.search, url.href),
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

  return createElement(RouterContext.Provider, { value: { url } }, routeEl);
};

class ErrorBoundary extends Component<{ Handler: FC<{ error: Error }> }, { error: Error | null }> {
  constructor(props: { Handler: FC<{ error: Error }> }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return createElement(this.props.Handler, { error: this.state.error });
    }

    return this.props.children;
  }
}

function Err({ status, statusText }: { status: number; statusText: string }) {
  return createElement(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100vw",
        height: "100vh",
        fontSize: 16,
      },
    },
    createElement("strong", { style: { fontWeight: "500" } }, status),
    createElement("small", { style: { color: "#999", padding: "0 6px" } }, "-"),
    statusText,
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

function loadSSRModulesFromTag(): RouteModule[] {
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
