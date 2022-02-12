import { renderToString } from "react-dom/server";
import { Router } from "aleph/react";
import { serve } from "aleph/server";

serve({
  ssr: (e: SSREvent) => {
    return renderToString(<Router ssr={e} />);
  },
});
