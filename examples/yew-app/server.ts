import { serve } from "aleph/server";
import init, { ssr } from "./pkg/yew_app.js";
import build from "./build.ts";

await init(await Deno.readFile("./pkg/yew_app_bg.wasm"));

serve({
  devServer: {
    watchFS: (_kind, specifier) => {
      if (specifier.startsWith("./src/") && specifier.endsWith(".rs")) {
        build();
      }
    },
  },
  ssr: {
    render: (_ctx) => ssr(),
  },
});
