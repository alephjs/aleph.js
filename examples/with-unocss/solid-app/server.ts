import { serve } from "aleph/server";
import denoDeploy from "aleph/plugins/deploy";
import solid from "aleph/plugins/solid";
import unocss from "aleph/plugins/unocss";
import config from "./unocss.config.ts";
import modules from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  plugins: [
    denoDeploy({ modules }),
    solid({ ssr: true }),
    unocss(config),
  ],
});
