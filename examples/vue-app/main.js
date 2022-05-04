import { Link, createSSRApp } from "aleph/vue";
import App from "./app.vue";

const app = createSSRApp(App)

app.component('Link', Link)

app.mount("#root", true)
