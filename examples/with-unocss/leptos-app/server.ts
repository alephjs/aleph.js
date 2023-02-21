import { serve } from "aleph/server";
import init, { ssr } from "./pkg/server.js";
import unocss from "./unocss.config.ts";

// Pre-imports `@unocss/core` for serverless env that doesn't support the dynamic import.
Reflect.set(globalThis, "UNOCSS", await import("@unocss/core"));

const wasmUrl = new URL("./pkg/server_bg.wasm", import.meta.url);
await init(await Deno.readFile(wasmUrl));

serve({
  baseUrl: import.meta.url,
  unocss: {
    test: /\.rs$/,
    ...unocss,
  },
  ssr: ({ url }) => ssr(url.href),
});
