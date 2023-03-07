import { serve } from "aleph/server";
import solid from "aleph/plugins/solid";
import unocss from "aleph/plugins/unocss";
import config from "./unocss.config.ts";
import routes from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  router: { routes },
  plugins: [
    solid({ ssr: true }),
    unocss(config),
  ],
});
