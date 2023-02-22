import { serve } from "aleph/server";
import unocss from "aleph/unocss";
import init, { ssr } from "./pkg/server.js";
import config from "./unocss.config.ts";

const wasmUrl = new URL("./pkg/server_bg.wasm", import.meta.url);
await init(await Deno.readFile(wasmUrl));

serve({
  baseUrl: import.meta.url,
  atomicCSS: unocss(/\.rs$/, config),
  ssr: ({ url }) => ssr(url.href),
});
