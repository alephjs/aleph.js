import { createSSRApp } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { serve } from "aleph/server";
import { renderToString } from "vue/server-renderer";
import App from "./app.vue";
import Hello from "./hello.vue";
import { routes } from "./routes.js";

const createSSRApp_ = async (ctx) => {
  const pathname = ctx.url.pathname;
  const ssrApp = createSSRApp(
    {
      "/": App,
      "/hello": Hello,
    }[pathname],
  );
  const router = createRouter({
    history: createMemoryHistory(),
    routes,
  });
  ssrApp.use(router);

  await router.push({ path: pathname });
  await router.isReady();

  return ssrApp;
};

serve({
  config: {
    routes: "./routes/**/*.{vue,tsx,ts}",
    unocss: {
      // to enable unocss, please add presets:
      // presets: [ unoPreset ],
    },
  },
  ssr: async (ctx) => await renderToString(await createSSRApp_(ctx)),
});
