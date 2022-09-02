import { serve } from "aleph/vue-server";
import routes from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  router: { routes },
  ssr: true,
});
