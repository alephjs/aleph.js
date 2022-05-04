import { createSSRApp } from "aleph/vue";
import App from "./app.vue";

createSSRApp(App).mount("#root", true);
