import { App, createSSRApp } from "aleph/vue";
import { serve } from "aleph/server";
import { renderToString } from "vue/server-renderer";

serve({
  config: {
    routes: "./routes/**/*.{vue,tsx,ts}",
    unocss: {
      // to enable unocss, please add presets:
      // presets: [ unoPreset ],
    },
  },
  ssr: async (ctx) => await renderToString(createSSRApp(App, { ssrContext: ctx }), ctx),
});
