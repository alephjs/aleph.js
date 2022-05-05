import { Component, createApp, createSSRApp, defineComponent, h } from "vue";
import type { SSRContext } from "../../server/renderer.ts";
import { DataContext, RouterContext } from "./context.ts";
import { RouteModule } from "../core/route.ts";
import { Link } from "./link.ts";
import { Head } from "./head.ts";

// deno-lint-ignore no-explicit-any
const global = window as any;

type RouteData = {
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
  setup() {
    console.log("App setup");
  },
  mounted() {
    console.log("App mounted");
  },
  render() {
    return this.$slots.default ? this.$slots.default() : [];
  },
});

export const Err = defineComponent({
  name: "Err",
  props: {
    status: {
      type: String,
      default: "404",
    },
  },
  render() {
    return h("div", {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100vw",
        height: "100vh",
        fontSize: 16,
      },
    }, [
      h("strong", { style: { fontWeight: "500" } }, this.$props.status),
      h("small", { style: { color: "#999", padding: "0 6px" } }, "-"),
      "page not found",
    ]);
  },
});

const createSSRApp_ = (_app: Component, props?: RootProps) => {
  const { ssrContext } = props || {};
  const routeModules = ssrContext?.routeModules || loadSSRModulesFromTag();

  const dataCache = new Map<string, RouteData>();
  routeModules.forEach(({ url, data, dataCacheTtl }) => {
    dataCache.set(url.pathname + url.search, {
      data,
      dataCacheTtl,
      dataExpires: Date.now() + (dataCacheTtl || 1) * 1000,
    });
  });

  // clean
  DataContext.ssrHeadCollection = [];

  let routeComponent = undefined;

  if (routeModules && routeModules.length > 0) {
    const defaultRouteModules = routeModules[0];
    const { url, defaultExport } = defaultRouteModules;
    if (defaultExport) {
      routeComponent = defaultExport as Component;
    }

    const dataUrl = url.pathname + url.search;
    DataContext.dataUrl = dataUrl;
    DataContext.dataCache = dataCache;
  }

  if (ssrContext?.url) {
    RouterContext.value.url = ssrContext?.url;
  }

  if (routeComponent) {
    const ssrApp = createSSRApp(routeComponent);

    const ssrHeadCollection = DataContext?.ssrHeadCollection;
    if (ssrHeadCollection && ssrHeadCollection.length > 0) {
      if (ssrContext?.headCollection) {
        ssrHeadCollection.forEach((item) => {
          ssrContext.headCollection.push(item);
        });
      }
    }

    // registe aleph/vue component
    ssrApp.component("Link", Link);
    ssrApp.component("Head", Head);

    return ssrApp;
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
  const { url, params } = RouterContext.value;
  return { url, params };
};

export { createApp_ as createApp, createSSRApp_ as createSSRApp };
