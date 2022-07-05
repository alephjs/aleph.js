import { serve } from "aleph/server";

// pre-import routes
import routes from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  routeGlob: "./routes/**/*.ts",
  routes,
});
