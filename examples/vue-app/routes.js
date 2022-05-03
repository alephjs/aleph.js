import app from "./app.vue";
import hello from "./hello.vue";

const routes = [
  {
    path: "/",
    component: app,
  },
  { path: "/hello", component: hello },
];

export { routes };
