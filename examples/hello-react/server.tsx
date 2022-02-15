import { renderToString } from "react-dom/server";
import { Router } from "aleph/react";
import { serve } from "aleph/server";

serve({
  routes: "./routes/**/*.tsx",
  ssr: (ssrEvent) => {
    return renderToString(<Router ssr={ssrEvent} />);
  },
});
