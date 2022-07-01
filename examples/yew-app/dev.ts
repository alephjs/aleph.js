import dev, { createFsEmitter } from "aleph/server/dev.ts";
import build from "./build.ts";

const emitter = createFsEmitter();
emitter.on("*", (_kind, { specifier }) => {
  if (specifier.startsWith("./src/") && specifier.endsWith(".rs")) {
    build();
  }
});

await build();

dev({
  baseUrl: import.meta.url,
});
