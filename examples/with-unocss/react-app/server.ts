import { serve } from "aleph/server";
import react from "aleph/plugins/react";
import unocss from "aleph/plugins/unocss";
import config from "./unocss.config.ts";
import routes from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  plugins: [
    react({ ssr: true }),
    unocss(config),
  ],
  router: { routes },
});
