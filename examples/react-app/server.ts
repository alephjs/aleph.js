/** @format */

import { serve } from "aleph/server";
import react from "aleph/plugins/react";
import denoDeploy from "aleph/plugins/deploy";
import modules from "./routes/_export.ts";

serve({
  plugins: [
    denoDeploy({ moduleMain: import.meta.url, modules }),
    react({ ssr: true }),
  ],
});
