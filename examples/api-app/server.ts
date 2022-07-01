import { serve } from "aleph/server";

serve({
  routes: {
    baseUrl: import.meta.url,
    match: "./routes/**/*.ts",
  },
});
