import { serve } from "aleph/server";
import denoDeploy from "aleph/plugins/deploy";
import modules from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  plugins: [
    denoDeploy({ modules }),
  ],
  middlewares: [
    // add your middlewares here
  ],
});
