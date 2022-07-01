import { App, createSSRApp } from "aleph/vue";
import { serve } from "aleph/server";
import VueLoader from "aleph/loaders/vue.ts";
import { renderToString } from "vue/server-renderer";

serve({
  routes: {
    match: "./routes/**/*.{vue,ts}",
    baseUrl: import.meta.url,
  },
  ssr: (ctx) => renderToString(createSSRApp(App, { ssrContext: ctx }), ctx),
  loaders: [new VueLoader()],
});
