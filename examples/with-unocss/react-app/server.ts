import { serve } from "aleph/react-server";
import routes from "./routes/_export.ts";
import unocss from "./unocss.config.ts";

serve({
  baseUrl: import.meta.url,
  router: { routes },
  ssr: true,
  unocss,
});
