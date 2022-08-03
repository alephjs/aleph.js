import { serve } from "aleph/server";
import SolidLoader from "aleph/solid-loader";
import { generateHydrationScript, renderToString } from "solid-js/web";
import routes from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  loaders: [new SolidLoader()],
  router: { routes },
  ssr: (ctx) => {
    const App = ctx.routeModules[0].defaultExport; // routes/index.tsx
    ctx.headCollection.push(generateHydrationScript());
    return renderToString(App);
  },
});
