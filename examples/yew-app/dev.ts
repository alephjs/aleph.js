import dev, { createWatchFsEmitter } from "aleph/dev";
import { build } from "./build.ts";

const emitter = createWatchFsEmitter();
emitter.on("*", (kind, { specifier }) => {
  if (kind.startsWith("modify:") && specifier.endsWith(".rs")) {
    build();
  }
});

await build();

dev({
  baseUrl: import.meta.url,
});
