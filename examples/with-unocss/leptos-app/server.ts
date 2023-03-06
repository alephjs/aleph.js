import { serve } from "aleph/server";
import UnoCSS from "aleph/unocss";
import config from "./unocss.config.ts";
import init, { ssr } from "./pkg/server.js";

const wasmUrl = new URL("./pkg/server_bg.wasm", import.meta.url);
await init(await Deno.readFile(wasmUrl));

serve({
  baseUrl: import.meta.url,
  atomicCSS: UnoCSS(/\.rs$/, config),
  ssr: ({ url }) => ssr(url.href),
});
