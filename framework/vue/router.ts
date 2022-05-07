import { Component, createSSRApp as VueCreateSSRApp, defineComponent, h } from "vue";
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

const createApp = (props?: RootProps) => {
  return createRouter(props);
};

const createRouter = (props?: RootProps) => {
  const { ssrContext } = props || {};
  const modules = ssrContext?.routeModules || loadSSRModulesFromTag();

  if (modules.length === 0) {
    return VueCreateSSRApp(Err, { status: 404, message: "page not found" });
  }

  const url = ssrContext?.url || new URL(window.location?.href);
  const dataUrl = url.pathname + url.search;
  const params: Record<string, string> = {};
  const dataCache = new Map<string, RouteData>();

  RouterContext.value = { url, params };

  modules.forEach((module) => {
    const { params: _params, data, dataCacheTtl } = module;
    Object.assign(params, _params);
    dataCache.set(url.pathname + url.search, {
      data,
      dataCacheTtl,
      dataExpires: Date.now() + (dataCacheTtl || 1) * 1000,
    });
  });

  const defaultRouteModules = modules[0];
  const { defaultExport } = defaultRouteModules;

  if (defaultExport) {
    const router = defineComponent({
      name: "Router",
      render() {
        return [h(defaultExport as Component)];
      },
    });

    const app = VueCreateSSRApp(router);

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

const useRouter = () => {
  return RouterContext;
};

export { createApp as App, createSSRApp, useRouter };
