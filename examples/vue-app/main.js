import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import App from "./app.vue";
import Hello from "./hello.vue";
import { routes } from "./routes.js";

const router = createRouter({
  history: createWebHistory(),
  routes,
});

const pathname = location.pathname;
const app = createApp(
  {
    "/": App,
    "/hello": Hello,
  }[pathname],
);

app.use(router);
await router.push({ path: pathname });

router.isReady().then(() => {
  app.mount("#root", true);
});
