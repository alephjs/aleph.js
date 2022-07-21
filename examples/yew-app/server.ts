import { serve } from "aleph/server";
import init, { ssr } from "./pkg/yew_app.js";
import { createWatchFsEmitter } from "aleph/dev";
import { build } from "./build.ts";

const initWasm = async () => {
  const wasmUrl = new URL("./pkg/yew_app_bg.wasm", import.meta.url);
  await init(await Deno.readFile(wasmUrl));
};

if (Deno.args.includes("--dev")) {
  const emitter = createWatchFsEmitter();
  emitter.on("modify", ({ specifier }) => {
    if (specifier.endsWith(".rs")) {
      build().then(initWasm);
    }
  });
  await build();
}

await initWasm();

serve({
  baseUrl: import.meta.url,
  ssr: ({ url }) => ssr(url.href),
});
