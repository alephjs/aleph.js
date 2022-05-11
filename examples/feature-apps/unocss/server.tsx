import presetUno from "@unocss/preset-uno.ts";
import presetIcons from "@unocss/preset-icons.ts";
import { App } from "aleph/react";
import { serve } from "aleph/server";
import { renderToString } from "react-dom/server";

serve({
  routes: "./routes/**/*.tsx",
  build: {
    unocss: {
      presets: [
        presetUno(),
        presetIcons({
          cdn: "https://esm.sh/",
        }),
      ],
    },
  },
  ssr: (ctx) => renderToString(<App ssrContext={ctx} />),
});
