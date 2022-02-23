import { Router } from "aleph/react";
import { serve } from "aleph/server";
import { renderToString } from "react-dom/server";

serve({
  config: {
    routeFiles: "./routes/**/*.tsx",
  },
  ssr: (ctx) => renderToString(<Router ssr={ctx} />),
});
