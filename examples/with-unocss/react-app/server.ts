import { serve } from "aleph/react-server";
import UnoCSS from "aleph/unocss";
import config from "./unocss.config.ts";
import routes from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  router: { routes },
  atomicCSS: UnoCSS(config),
  ssr: true,
});
