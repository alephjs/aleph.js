import {
  Component,
  computed,
  createSSRApp as VueCreateSSRApp,
  defineComponent,
  h,
  onBeforeUnmount,
  Ref,
  ref,
  ShallowRef,
  shallowRef,
  watch,
} from "vue";
import { matchRoutes, Route, RouteMeta, RouteModule, Routes } from "../core/route.ts";
import events from "../core/events.ts";
import FetchError from "../core/fetch_error.ts";
import type { SSRContext } from "../../server/renderer.ts";
import { RouterContext } from "./context.ts";
import { Link } from "./link.ts";
import { Head } from "./head.ts";
import { Err } from "./error.ts";
import { URLPatternCompat } from "../core/url_pattern.ts";

// deno-lint-ignore no-explicit-any
const global = window as any;

export type RouteData = {
  data?: unknown;
  dataCacheTtl?: number;
  dataExpires?: number;
};

type RootProps = {
  ssrContext?: SSRContext;
};

const createApp = (props?: RootProps) => {
  return createAppApi(props);
};

type RouterProps = {
  modules: ShallowRef<RouteModule[]>;
  url: Ref<URL>;
  dataCache: Map<string, RouteData>;
  dataUrl: Ref<string>;
};

const createRouter = (props: RouterProps) => {
  const { modules, url, dataCache, dataUrl } = props;

  const routeModules = getRouteModules();
  const routes = loadRoutesFromTag();

  watch(() => modules.value, () => {
    const params: Record<string, string> = {};
    const _dataUrl = url.value.pathname + url.value.search;
    modules.value.forEach((module) => {
      const { params: _params, data, dataCacheTtl } = module;
      Object.assign(params, _params);
      dataCache.set(_dataUrl, {
        data,
        dataCacheTtl,
        dataExpires: Date.now() + (dataCacheTtl || 1) * 1000,
      });
    });
    dataUrl.value = _dataUrl;
    RouterContext.value = { url: url.value, params };
  }, { immediate: true });

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
        alert(`Fetch Data: ${err.message}`);
        history.back();
        return;
      }
      const cc = res.headers.get("Cache-Control");
      rd.dataCacheTtl = cc?.includes("max-age=") ? parseInt(cc.split("max-age=")[1]) : undefined;
      rd.dataExpires = Date.now() + (rd.dataCacheTtl || 1) * 1000;
      return await res.json();
    };
    rd.data = await fetchData();
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
    const next_url = (e.url as URL | undefined) || new URL(window.location.href);
    const matches = matchRoutes(next_url, routes);
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
      };
      const dataUrl = rmod.url.pathname + rmod.url.search;
      if (filename in routeModules) {
        rmod.defaultExport = routeModules[filename].defaultExport;
      } else {
        const { defaultExport } = await importModule(meta);
        rmod.defaultExport = defaultExport;
      }
      if (!dataCache.has(dataUrl) && routeModules[filename]?.withData === true) {
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

  const Router = defineComponent({
    name: "Router",
    setup() {
      const defaultExport = computed(() => {
        if (modules.value.length > 0) {
          const defaultExport = modules.value[0].defaultExport;
          if (defaultExport) {
            return modules.value[0].defaultExport;
          }
        }
        // { status: 404, statusText: "page not found" }
        return Err;
      });

      // todo: update routes by hmr

      onBeforeUnmount(() => {
        removeEventListener("popstate", onpopstate as unknown as EventListener);
        events.off("popstate", onpopstate);
        events.off("moduleprefetch", onmoduleprefetch);
      });
      return {
        defaultExport,
      };
    },
    render() {
      return [h(this.defaultExport as Component)];
    },
  });

  return Router;
};

const createAppApi = (props?: RootProps) => {
  const { ssrContext } = props || {};
  const modules = shallowRef(ssrContext?.routeModules || loadSSRModulesFromTag());

  if (modules.value.length === 0) {
    return VueCreateSSRApp(Err, { status: 404, message: "page not found" });
  }

  const url = ref(ssrContext?.url || new URL(window.location?.href));
  const dataCache = new Map<string, RouteData>();
  const dataUrl = ref(url.value.pathname + url.value.search);

  const defaultRouteModules = modules.value[0];
  const { defaultExport } = defaultRouteModules;

  if (defaultExport) {
    const Router = createRouter({ modules, url, dataCache, dataUrl });
    const App = defineComponent({
      name: "App",
      render() {
        return [h(Router)];
      },
    });

    const app = VueCreateSSRApp(App);

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

  const errApp = VueCreateSSRApp(Err);

  return errApp;
};

const createSSRApp = (createSSRAppApi: (props?: RootProps) => Component, props?: RootProps) => {
  if (createSSRAppApi === undefined) {
    throw new Error("[aleph/vue] createSSRApp without `App` component");
  }

  return createSSRAppApi(props);
};

function getRouteModules(): Record<string, { defaultExport?: unknown; withData?: boolean }> {
  return global.__ROUTE_MODULES || (global.__ROUTE_MODULES = {});
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

function loadRoutesFromTag(): Routes {
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

const useRouter = () => {
  return RouterContext;
};

export { createApp as App, createSSRApp, useRouter };
