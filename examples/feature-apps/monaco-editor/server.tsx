import { renderToString } from "react-dom/server";
import { Router } from "aleph/react";
import { serve } from "aleph/server";

serve({
  config: {
    routes: "./routes/**/*.tsx",
  },
  ssr: (ctx) => renderToString(<Router ssrContext={ctx} />),
});
