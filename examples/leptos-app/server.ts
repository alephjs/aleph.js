import { serve } from "aleph/server";
import init, { ssr } from "./pkg/server.js";

const wasmUrl = new URL("./pkg/server_bg.wasm", import.meta.url);
await init(await Deno.readFile(wasmUrl));

serve({
  ssr: ({ url }) => {
    return ssr(url.href);
  },
});
