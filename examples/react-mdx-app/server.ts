import { serve } from "aleph/react-server";
import MDXLoader from "aleph/react/mdx-loader";
import routes from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  loaders: [new MDXLoader()],
  router: {
    glob: "./routes/**/*.{tsx,mdx,md}",
    routes,
  },
  ssr: true,
});
