import { Component, createApp, createSSRApp, MethodOptions } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";

const createSSRApp_ = async (app: Component, routes: any, ctx: { url: { pathname: any } }) => {
  const ssrApp = createSSRApp(app);
  const router = createRouter({
    history: createMemoryHistory(),
    routes,
  });
  ssrApp.use(router);

  const pathname = ctx.url.pathname;
  await router.push(pathname);

  await router.isReady();

  return ssrApp;
};

export { createSSRApp_ as createSSRApp };
