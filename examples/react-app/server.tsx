import { App } from "aleph/react";
import { serve } from "aleph/server";
import { renderToReadableStream } from "react-dom/server";

serve({
  routes: "./routes/**/*.{tsx,ts}",
  // to enable unocss, please add presets to unocss options
  // please check https://alephjs.org/docs/unocss
  unocss: {
    // presets: [ unoPreset ],
  },
  ssr: {
    // when set `suspense` to `true`, the router will loading data in suspense mode
    // please check https://alephjs.org/docs/react/router/suspense
    suspense: false,
    render: (ctx) => renderToReadableStream(<App ssrContext={ctx} />, ctx),
  },
});
