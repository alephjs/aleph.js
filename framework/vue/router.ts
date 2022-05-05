import { Component, createApp, createSSRApp, defineComponent, resolveComponent } from "vue";
import type { SSRContext } from "../../server/renderer.ts";
import { DataContext, RouterContext } from "./context.ts";
import { RouteModule } from "../core/route.ts";
import { Link } from "./link.ts";
import { Head } from "./head.ts";

// deno-lint-ignore no-explicit-any
const global = window as any;

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

type RootProps = {
  ssrContext?: SSRContext;
};

const createSSRApp_ = (app: Component, props?: RootProps) => {
  const { ssrContext } = props || {};
  const routeModules = ssrContext?.routeModules || loadSSRModulesFromTag();

  // clean
  DataContext.value.ssrHeadCollection = [];

  let routeComponent = undefined;

  if (routeModules && routeModules.length > 0) {
    const defaultRouteModules = routeModules[0];
    const { defaultExport } = defaultRouteModules;
    if (defaultExport) routeComponent = defaultExport as Component;
  }

  const ssrApp = createSSRApp(routeComponent || app);

  if (ssrContext?.url) {
    RouterContext.value.url = ssrContext?.url;
  }

  const ssrHeadCollection = DataContext?.value?.ssrHeadCollection;
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
