import { serve } from "aleph/server";
import react from "aleph/plugins/react";
import routes from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  router: { routes },
  plugins: [
    react({ ssr: true }),
  ],
});
