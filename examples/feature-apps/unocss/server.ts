import presetUno from "@unocss/preset-uno.ts";
import presetIcons from "@unocss/preset-icons.ts";
import { serve } from "aleph/server";
import ssr from "aleph/react-ssr";

// pre-import routes
import routes from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  routeGlob: "./routes/**/*.tsx",
  routes,
  unocss: {
    presets: [
      presetUno(),
      presetIcons({
        cdn: "https://esm.sh/",
      }),
    ],
  },
  ssr,
});
