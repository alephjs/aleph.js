import { App, createSSRApp } from "aleph/vue";
import { serve } from "aleph/server";
import VueLoader from "aleph/vue-loader";
import { renderToString } from "vue/server-renderer";
import routeModules from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  routes: "./routes/**/*.{vue,ts}",
  routeModules,
  ssr: (ctx) => renderToString(createSSRApp(App, { ssrContext: ctx }), ctx),
  loaders: [new VueLoader()],
});
