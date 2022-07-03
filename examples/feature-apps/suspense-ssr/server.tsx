import { App } from "aleph/react";
import { serve } from "aleph/server";
import { renderToReadableStream } from "react-dom/server";

serve({
  baseUrl: import.meta.url,
  routes: "./routes/**/*.tsx",
  ssr: {
    dataDefer: true,
    render: (ctx) => renderToReadableStream(<App ssrContext={ctx} />, ctx),
  },
});
