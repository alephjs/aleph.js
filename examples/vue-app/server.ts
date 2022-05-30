import { App, createSSRApp } from "aleph/vue";
import { serve } from "aleph/server";
import { renderToString } from "vue/server-renderer";

serve({
  routes: "./routes/**/*.{vue,ts}",
  build: {
    unocss: {
      // to enable unocss, please add presets to unocss options
      // please check https://alephjs.org/docs/unocss
    },
  },
  ssr: async (ctx) => await renderToString(createSSRApp(App, { ssrContext: ctx }), ctx),
});
