import { serve } from "aleph/server";
import unocss from "aleph/plugins/unocss";
import config from "./unocss.config.ts";
import init, { ssr } from "./pkg/server.js";

const wasmUrl = new URL("./pkg/server_bg.wasm", import.meta.url);
await init(await Deno.readFile(wasmUrl));

serve({
  plugins: [
    unocss(/\.rs$/, config),
  ],
  ssr: ({ url }) => ssr(url.href),
});
