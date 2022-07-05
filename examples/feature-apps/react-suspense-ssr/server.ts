import { serve } from "aleph/server";
import render from "aleph/react-ssr";

// pre-import routes
import routes from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  routeGlob: "./routes/**/*.tsx",
  routes,
  ssr: {
    dataDefer: true,
    render,
  },
});
