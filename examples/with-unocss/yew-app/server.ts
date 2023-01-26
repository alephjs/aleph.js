import { serve } from "aleph/server";
import init, { ssr } from "./pkg/yew_app.js";
import unocss from "./unocss.config.ts";

// Pre-imports `@unocss/core` for serverless env that doesn't support the dynamic import.
import * as uno from "@unocss/core";
Reflect.set(globalThis, "UNOCSS_CORE", uno);

const wasmUrl = new URL("./pkg/yew_app_bg.wasm", import.meta.url);
await init(await Deno.readFile(wasmUrl));

serve({
  baseUrl: import.meta.url,
  unocss: {
    test: /\.rs$/,
    ...unocss,
  },
  ssr: ({ url }) => ssr(url.href),
});
