import { serve } from "aleph/server";
import ssr from "aleph/vue-ssr";
import VueLoader from "aleph/vue-loader";

// pre-import routes
import routes from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  router: { glob: "./routes/**/*.{vue,ts}", routes },
  loaders: [new VueLoader()],
  ssr,
});
