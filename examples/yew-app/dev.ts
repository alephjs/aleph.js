import dev, { createWatchFsEmitter } from "aleph/dev";
import { build } from "./build.ts";

const emitter = createWatchFsEmitter();
emitter.on("modify", ({ specifier }) => {
  if (specifier.endsWith(".rs")) {
    build();
  }
});

await build();

dev({
  baseUrl: import.meta.url,
});
