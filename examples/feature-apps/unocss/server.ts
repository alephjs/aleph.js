import presetUno from "@unocss/preset-uno.ts";
import presetIcons from "@unocss/preset-icons.ts";
import { serve } from "aleph/server";
import ssr from "aleph/react-ssr";

// pre-import route modules
import routeModules from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  routes: "./routes/**/*.tsx",
  routeModules,
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
