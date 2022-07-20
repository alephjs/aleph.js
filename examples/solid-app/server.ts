import { serve } from "aleph/server";
import SolidLoader from "aleph/solid-loader";

serve({
  baseUrl: import.meta.url,
  loaders: [new SolidLoader()],
  // todo: support fs-routing & ssr
});
