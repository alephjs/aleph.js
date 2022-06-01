import { App, createSSRApp } from "aleph/vue";
import { serve } from "aleph/server";
import { renderToString } from "vue/server-renderer";

serve({
  routes: "./routes/**/*.{vue,ts}",
  ssr: (ctx) => renderToString(createSSRApp(App, { ssrContext: ctx }), ctx),
});
