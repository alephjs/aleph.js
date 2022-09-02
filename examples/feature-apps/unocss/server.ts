import presetUno from "@unocss/preset-uno.ts";
import presetIcons from "@unocss/preset-icons.ts";
import { serve } from "aleph/react-server";
import routes from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  router: {
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
  ssr: true,
});
