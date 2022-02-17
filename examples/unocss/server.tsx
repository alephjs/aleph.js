import presetUno from "https://esm.sh/@unocss/preset-uno";
import { renderToString } from "react-dom/server";
import { Router } from "aleph/react";
import { serve } from "aleph/server";

serve({
  config: {
    routeFiles: "./routes/**/*.tsx",
    atomicCSS: {
      presets: [
        presetUno(),
      ],
    },
  },
  ssr: (ctx) => renderToString(<Router ssr={ctx} />),
});
