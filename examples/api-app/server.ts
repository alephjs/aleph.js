import { serve } from "aleph/server";

// pre-import route modules
import routeModules from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  routes: "./routes/**/*.ts",
  routeModules,
});
