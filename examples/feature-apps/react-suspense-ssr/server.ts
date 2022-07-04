import { serve } from "aleph/server";
import render from "aleph/react-ssr";

// pre-import route modules
import routeModules from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  routes: "./routes/**/*.tsx",
  routeModules,
  ssr: {
    dataDefer: true,
    render,
  },
});
