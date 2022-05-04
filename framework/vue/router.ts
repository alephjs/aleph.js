import { Component, createApp, createSSRApp } from "vue";
import type { SSRContext } from "../../server/renderer.ts";
import { RouterContext } from "./context.ts";
import { defineComponent } from "vue";

export const App = defineComponent({
  name: "App",
  props: {
    ssrContext: {
      type: String,
      default: "",
    },
  },
  setup() {
    console.log("App");
  },
  render() {
    return this.$slots.default ? this.$slots.default() : [];
  },
});

const createSSRApp_ = (app: Component, { ssrContext }: { ssrContext: SSRContext }) => {
  const routeModules = ssrContext?.routeModules;

  if (ssrContext?.url) {
    RouterContext.value.url = ssrContext?.url;
  }

  if (routeModules.length > 0) {
    const defaultRouteModules = routeModules[0];
    const { defaultExport } = defaultRouteModules;
    if (defaultExport) {
      return createSSRApp(defaultExport as Component);
    }
  }

  return createSSRApp(app);
};

const createApp_ = (app: Component) => {
  return createApp(app);
};

export const useRouter = () => {
  const { url, params } = RouterContext.value;
  return { url, params };
};

export { createApp_ as createApp, createSSRApp_ as createSSRApp };
