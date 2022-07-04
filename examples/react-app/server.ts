import { serve } from "aleph/server";
import ssr from "aleph/react-ssr";

// pre-import route modules
import routeModules from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  routes: "./routes/**/*.{tsx,ts}",
  routeModules,
  ssr,
});
