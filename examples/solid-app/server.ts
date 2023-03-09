import { serve } from "aleph/server";
import denoDeploy from "aleph/plugins/deploy";
import solid from "aleph/plugins/solid";
import modules from "./routes/_export.ts";

serve({
  plugins: [
    denoDeploy({ modules }),
    solid({ ssr: true }),
  ],
});
