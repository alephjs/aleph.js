import { createWatchFsEmitter } from "aleph/dev";
import { serve } from "aleph/server";
import { build } from "./build.ts";

let ssr: CallableFunction = () => {};
let t = 0;

const initWasm = async () => {
  const { default: init, ssr: ssrFn } = await import(`./pkg/yew_app.js#${t++}`);
  const wasmUrl = new URL("./pkg/yew_app_bg.wasm", import.meta.url);
  await init(await Deno.readFile(wasmUrl));
  ssr = ssrFn;
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
