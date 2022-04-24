import "./routes.gen.ts"
import { Router } from "aleph/react";
import { serve } from "aleph/server";
import { renderToReadableStream } from "react-dom/server";

serve({
  config: {
    routes: { glob: "./routes/**/*.{tsx,ts}", generate: true },
  },
  ssr: {
    suspense: true,
    render: (ctx) => renderToReadableStream(<Router ssrContext={ctx} />, ctx),
  },
});
