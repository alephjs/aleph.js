import { serve } from "aleph/server";
import ssr from "aleph/react-ssr";
import routes from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  router: {
    glob: "./routes/**/*.{tsx,ts}",
    routes,
  },
  unocss: "preset",
  ssr,
  dev: {
    reactRefresh: true,
  },
});
