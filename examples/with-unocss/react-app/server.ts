import { serve } from "aleph/react-server";
import unocss from "aleph/plugins/unocss";
import config from "./unocss.config.ts";
import routes from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  plugins: [
    unocss(config),
  ],
  router: { routes },
  ssr: true,
});
