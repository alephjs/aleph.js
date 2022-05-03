import { App } from "aleph/react";
import { serve } from "aleph/server";
import { renderToReadableStream } from "react-dom/server";

serve({
  config: {
    routes: "./routes/**/*.tsx",
  },
  ssr: {
    suspense: true,
    render: (ctx) => renderToReadableStream(<App ssrContext={ctx} />, ctx),
  },
});
