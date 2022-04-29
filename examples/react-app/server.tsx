import { Router } from "aleph/react";
import { serve } from "aleph/server";
import { renderToReadableStream } from "react-dom/server";

serve({
  config: {
    routes: "./routes/**/*.{tsx,ts}",
    unocss: {
      // to enable unocss, please add presets:
      // presets: [ unoPreset ],
    },
  },
  ssr: {
    // when set `suspense` to `true`, the router will loading data as suspense
    // please check https://alephjs.org/docs/react/router/suspense
    suspense: false,
    render: (ctx) => renderToReadableStream(<Router ssrContext={ctx} />, ctx),
  },
});
