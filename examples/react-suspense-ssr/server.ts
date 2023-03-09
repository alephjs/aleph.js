import { serve } from "aleph/server";
import denoDeploy from "aleph/plugins/deploy";
import react from "aleph/plugins/react";
import modules from "./routes/_export.ts";

serve({
  plugins: [
    denoDeploy({ modules }),
    react({ ssr: true }),
  ],
});
