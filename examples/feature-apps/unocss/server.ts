import presetUno from "@unocss/preset-uno.ts";
import presetIcons from "@unocss/preset-icons.ts";
import { serve } from "aleph/server";
import ssr from "aleph/react-ssr";
import routes from "./routes/_export.ts";

if (Deno.args.includes("--dev")) {
  // Enable react refresh
  Deno.env.set("REACT_REFRESH", "true");
}

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
  ssr,
});
