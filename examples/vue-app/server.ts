import { serve } from "aleph/server";
import vue from "aleph/plugins/vue";
import routes from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  router: { routes },
  plugins: [
    vue({ ssr: true }),
  ],
});
