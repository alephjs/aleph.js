import { Router } from "aleph/react";
import { serve } from "aleph/server";
import { renderToString } from "react-dom/server";

serve({
  config: {
    routes: "./routes/**/*.tsx",
  },
  ssr: {
    suspense: false,
    render: (ctx) => renderToString(<Router ssrContext={ctx} />),
  },
});
