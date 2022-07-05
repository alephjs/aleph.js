import { serve } from "aleph/server";
import init, { ssr } from "./pkg/yew_app.js";

const wasmUrl = new URL("./pkg/yew_app_bg.wasm", import.meta.url);
await init(await Deno.readFile(wasmUrl));

serve({
  baseUrl: import.meta.url,
  ssr: ({ url }) => ssr(url.href),
});
