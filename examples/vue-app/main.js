import { App, createSSRApp } from "aleph/vue";
import Header from "./components/Header.vue";

const app = createSSRApp(App);

app.component("Header", Header);

app.mount("#root", true);
