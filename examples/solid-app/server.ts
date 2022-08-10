import { serve } from "aleph/server";
import SolidLoader from "aleph/loaders/solid";
import { generateHydrationScript, renderToString } from "solid-js/web";
import routes from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  loaders: [new SolidLoader()],
  router: { routes },
  ssr: (ctx) => {
    const App = ctx.routeModules[0]?.defaultExport; // routes/index.tsx
    if (!App) {
      return "404 page not found";
    }
    ctx.headCollection.push(generateHydrationScript());
    return renderToString(App as () => unknown);
  },
});
