import { serve } from "aleph/server";
import ssr from "aleph/vue-ssr";
import VueLoader from "aleph/loaders/vue";
import routes from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  loaders: [new VueLoader()],
  router: {
    exts: [".vue", ".ts"],
    routes,
  },
  ssr,
});
