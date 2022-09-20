import type { Component, Ref, ShallowRef } from "vue";
import { createSSRApp, defineComponent, h, ref, shallowRef, watch } from "vue";
import type { Route, RouteMeta, RouteModule, Router } from "../core/route.ts";
import { matchRoutes } from "../core/route.ts";
import events from "../core/events.ts";
import { FetchError } from "../core/error.ts";
import { URLPatternCompat } from "../core/url_pattern.ts";
import type { SSRContext } from "../../server/types.ts";
import { RouterContext } from "./context.ts";
import { Link } from "./link.ts";
import { Head } from "./head.ts";
import { Err } from "./error.ts";

export type RouteData = {
  data?: unknown;
  dataCacheTtl?: number;
  dataExpires?: number;
};

type RootProps = {
  ssrContext?: SSRContext;
};

type RouterProps = {
  modules: ShallowRef<RouteModule[]>;
  url: Ref<URL>;
  dataCache: Map<string, RouteData>;
  dataUrl: Ref<string>;
};

type RouterRootProps = {
  modules: ShallowRef<RouteModule[]>;
  dataCache: Map<string, RouteData>;
  ssrContext?: SSRContext;
};

const createRouter = ({ modules, url, dataCache, dataUrl }: RouterProps) => {
  const router = loadRouterFromTag();
  const _dataUrl = url.value.pathname + url.value.search;

  modules.value.forEach((module) => {
    const { data, dataCacheTtl } = module;
    dataCache.set(_dataUrl, {
      data,
      dataCacheTtl,
      dataExpires: Date.now() + (dataCacheTtl || 1) * 1000,
    });
  });

  watch(() => modules.value, () => {
    const params: Record<string, string> = {};
    modules.value.forEach((m) => Object.assign(params, m.params));
    dataUrl.value = url.value.pathname + url.value.search;
    RouterContext.value = { url: url.value, params };
  }, { immediate: true });

  const prefetchData = async (dataUrl: string) => {
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
        throw err;
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
    rd.data = await fetchData();
    dataCache.set(dataUrl, rd);
  };

  const onmoduleprefetch = (e: Record<string, unknown>) => {
    const deployId = document.body.getAttribute("data-deployment-id");
    const pageUrl = new URL(e.href as string, location.href);
    const matches = matchRoutes(pageUrl, router);
    matches.map(([_, meta]) => {
      const { filename } = meta;
      try {
        __aleph.getRouteModule(filename);
      } catch (_e) {
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
    const next_url = (e.url as URL | undefined) || new URL(window.location.href);
    const matches = matchRoutes(next_url, router);
    const loadingBar = getLoadingBar();
    let loading: number | null = setTimeout(() => {
      loading = null;
      loadingBar.style.opacity = "1";
      loadingBar.style.width = "50%";
    }, 300);
    const next_modules = await Promise.all(matches.map(async ([ret, meta]) => {
      const { filename } = meta;
      const rmod: RouteModule = {
        url: new URL(ret.pathname.input + next_url.search, next_url.href),
        params: ret.pathname.groups,
        filename,
        exports: await __aleph.importRouteModule(filename),
      };
      const dataUrl = rmod.url.pathname + rmod.url.search;
      const dataConfig = rmod.exports.data as undefined | Record<string, boolean>;
      rmod.withData = Boolean(dataConfig?.get || dataConfig?.GET);
      if (rmod.withData && !dataCache.has(dataUrl)) {
        await prefetchData(dataUrl);
      }
      return rmod;
    }));
    modules.value = next_modules;
    url.value = next_url;
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
          clearLoadingBar = null;
          loadingBar.remove();
        }, (moveOutTime + fadeOutTime) * 1000);
        clearLoadingBar = () => {
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
  const Router = defineComponent({
    name: "Router",
    beforeUnmount() {
      removeEventListener("popstate", onpopstate as unknown as EventListener);
      events.off("popstate", onpopstate);
      events.off("moduleprefetch", onmoduleprefetch);
    },
    render() {
      if (modules.value.length > 0) {
        const defaultExport = modules.value[0].exports.default;
        if (modules.value.length > 1) {
          return h(
            defaultExport as Component,
            null,
            () => h(createRouterRoot({ modules: shallowRef(modules.value.slice(1)), dataCache })),
          );
        }
        return h(defaultExport as Component);
      }
      return h(Err, { status: 404, message: "page not found" });
    },
  });

  return Router;
};

const createRouterRoot = (props: RouterRootProps) => {
  const { modules, dataCache } = props;

  const RouterRoot = defineComponent({
    name: "RouterRoot",
    render() {
      if (modules.value.length > 0) {
        const defaultExport = modules.value[0].exports.default;
        if (modules.value.length > 1) {
          return h(
            defaultExport as Component,
            null,
            () => h(createRouterRoot({ modules: shallowRef(modules.value.slice(1)), dataCache })),
          );
        }
        if (defaultExport && typeof defaultExport === "object") {
          return h(defaultExport as Component);
        }
        return h(Err, { status: 400, message: "missing default export as a valid Vue component" });
      }
      throw new Error("modules must be non-empty array");
    },
  });

  return RouterRoot;
};

const createApp = (props?: RootProps) => {
  const { ssrContext } = props || {};
  const modules = shallowRef(ssrContext?.routing || loadSSRModulesFromTag());

  if (modules.value.length === 0) {
    return createSSRApp(Err, { status: 404, message: "page not found" });
  }

  const url = ref(ssrContext?.url || new URL(window.location?.href));
  const dataCache = new Map<string, RouteData>();
  const dataUrl = ref(url.value.pathname + url.value.search);

  const defaultRouteModules = modules.value[0];
  const { exports } = defaultRouteModules;

  if (exports.default) {
    const Router = createRouter({ modules, url, dataCache, dataUrl });
    const app = createSSRApp(defineComponent({
      name: "App",
      render() {
        return [h(Router)];
      },
    }));

    app.provide("modules", modules);
    app.provide("dataCache", dataCache);
    app.provide("ssrContext", ssrContext);
    app.provide("ssrHeadCollection", ssrContext?.headCollection);
    app.provide("dataUrl", dataUrl);

    // registe aleph/vue component
    app.component("Link", Link);
    app.component("Head", Head);

    return app;
  }

  return createSSRApp(Err);
};

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
            }
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

function getLoadingBar(): HTMLDivElement {
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

function loadRouterFromTag(): Router {
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
      throw new Error(`loadRouterFromTag: ${e.message}`);
    }
  }
  return { routes: [], prefix: "" };
}

const useRouter = () => {
  return RouterContext;
};

export { createApp, useRouter };
