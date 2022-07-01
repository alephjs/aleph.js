import { serve } from "aleph/server";
import init, { ssr } from "./pkg/yew_app.js";

await init(await Deno.readFile(new URL("./pkg/yew_app_bg.wasm", import.meta.url)));

serve({
  baseUrl: import.meta.url,
  ssr: {
    render: (ctx) => ssr(ctx.url.href),
  },
});
