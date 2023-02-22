import { serve } from "aleph/server";
import unocss from "aleph/unocss";
import init, { ssr } from "./pkg/yew_app.js";
import config from "./unocss.config.ts";

const wasmUrl = new URL("./pkg/yew_app_bg.wasm", import.meta.url);
await init(await Deno.readFile(wasmUrl));

serve({
  baseUrl: import.meta.url,
  atomicCSS: unocss(/\.rs$/, config),
  ssr: ({ url }) => ssr(url.href),
});
