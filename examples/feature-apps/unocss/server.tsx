import presetUno from "@unocss/preset-uno.ts";
import presetIcons from "@unocss/preset-icons.ts";
import carbonIcons from "https://esm.sh/@iconify-json/carbon@1.1.2/icons.json" assert { type: "json" };
import { renderToString } from "react-dom/server";
import { Router } from "aleph/react";
import { serve } from "aleph/server";

serve({
  config: {
    routeFiles: "./routes/**/*.tsx",
    atomicCSS: {
      presets: [
        presetUno(),
        presetIcons({
          collections: {
            carbon: () => carbonIcons,
          },
        }),
      ],
    },
  },
  ssr: (ctx) => renderToString(<Router ssrContext={ctx} />),
});
