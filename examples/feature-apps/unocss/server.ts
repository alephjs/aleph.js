import presetUno from "@unocss/preset-uno.ts";
import presetIcons from "@unocss/preset-icons.ts";
import { serve } from "aleph/server";
import ssr from "aleph/react-ssr";
import routes from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  router: {
    glob: "./routes/**/*.tsx",
    routes,
  },
  unocss: {
    presets: [
      presetUno(),
      presetIcons({
        cdn: "https://esm.sh/",
      }),
    ],
  },
  ssr,
  dev: {
    reactRefresh: true,
  },
});
