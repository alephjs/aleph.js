import { serve } from "aleph/server";
import unocss from "aleph/plugins/unocss";
import config from "./unocss.config.ts";
import init, { ssr } from "./pkg/yew_app.js";

const wasmUrl = new URL("./pkg/yew_app_bg.wasm", import.meta.url);
await init(await Deno.readFile(wasmUrl));

serve({
  plugins: [
    unocss(/\.rs$/, config),
  ],
  ssr: ({ url }) => ssr(url.href),
});
