// support jsx on deno deploy
/** @jsxImportSource https://esm.sh/react@18.1.0 */

import { App } from "aleph/react";
import { serve } from "aleph/server";
import { renderToReadableStream } from "react-dom/server";
import routeModules from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  routes: "./routes/**/*.{tsx,ts}",
  routeModules,
  ssr: {
    // when set `dataDefer` to `true`, the router will loading data as defer
    dataDefer: false,
    render: (ctx) => renderToReadableStream(<App ssrContext={ctx} />, ctx),
  },
});
