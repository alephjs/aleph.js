import presetUno from "https://esm.sh/@unocss/preset-uno@0.30.2";
// import presetIcons from "https://esm.sh/@unocss/preset-icons@0.30.2";
// import carbonIcons from "https://esm.sh/@iconify-json/carbon@1.1.2/icons.json" assert { type: "json" };
import { renderToString } from "react-dom/server";
import { Router } from "aleph/react";
import { serve } from "aleph/server";

serve({
  config: {
    routeFiles: "./routes/**/*.tsx",
    atomicCSS: {
      presets: [
        presetUno(),
        // presetIcons({
        //   collections: {
        //     carbon: () => carbonIcons,
        //   },
        // }),
      ],
    },
  },
  ssr: (ctx) => renderToString(<Router ssrContext={ctx} />),
});
