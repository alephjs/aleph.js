import { serve } from "aleph/server";
import solid from "aleph/plugins/solid";
import routes from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  router: { routes },
  plugins: [
    solid({ ssr: true }),
  ],
});
