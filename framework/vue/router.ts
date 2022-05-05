import { Component, createApp, createSSRApp, defineComponent } from "vue";
import type { SSRContext } from "../../server/renderer.ts";
import { RouterContext } from "./context.ts";
import { RouteModule } from "../core/route.ts";
import { Link } from "./link.ts";
import { Head } from "./head.ts";
import { Err } from "./error.ts";

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

export const App = defineComponent({
  name: "App",
  props: {
    ssrContext: {
      type: String,
      default: "",
    },
  },
  render() {
    return this.$slots.default ? this.$slots.default() : [];
  },
});

const createSSRApp_ = (_app: Component, props?: RootProps) => {
  const { ssrContext } = props || {};
  const modules = ssrContext?.routeModules || loadSSRModulesFromTag();

  if (modules.length === 0) {
    return createSSRApp(Err, { status: 404, message: "page not found" });
  }

  const url = ssrContext?.url || new URL(window.location?.href);
  const dataUrl = url.pathname + url.search;
  const params: Record<string, string> = {};
  const dataCache = new Map<string, RouteData>();

  modules.forEach((module) => {
    const { params: _params, data, dataCacheTtl } = module;
    Object.assign(params, _params);
    dataCache.set(url.pathname + url.search, {
      data,
      dataCacheTtl,
      dataExpires: Date.now() + (dataCacheTtl || 1) * 1000,
    });
  });

  let routeComponent = undefined;

  const defaultRouteModules = modules[0];
  const { defaultExport } = defaultRouteModules;

  if (defaultExport) {
    routeComponent = defaultExport as Component;

    if (routeComponent) {
      const router = createApp(routeComponent);

      router.provide("modules", modules);
      router.provide("dataCache", dataCache);
      router.provide("ssrContext", ssrContext);
      router.provide("ssrHeadCollection", ssrContext?.headCollection);
      router.provide("dataUrl", dataUrl);

      // registe aleph/vue component
      router.component("Link", Link);
      router.component("Head", Head);

      return router;
    }
  }

  const ssrApp = createSSRApp(Err);

  return ssrApp;
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

const createApp_ = (app: Component) => {
  return createApp(app);
};

export const useRouter = () => {
  const { url, params } = RouterContext;
  return { url, params };
};

export { createApp_ as createApp, createSSRApp_ as createSSRApp };
