import { serve } from "aleph/server";
import denoDeploy from "aleph/plugins/deploy";
import vue from "aleph/plugins/vue";
import modules from "./routes/_export.ts";

serve({
  plugins: [
    denoDeploy({ modules }),
    vue({ ssr: true }),
  ],
});
