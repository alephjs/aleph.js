import { serve } from "aleph/solid-server";
import routes from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  router: { routes },
  ssr: true,
});
