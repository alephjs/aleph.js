import dev, { createWatchFsEmitter } from "aleph/dev";
import { build } from "./build.ts";

const emitter = createWatchFsEmitter();
emitter.on("*", (_kind, { specifier }) => {
  if (
    (specifier.startsWith("./src/") && specifier.endsWith(".rs")) ||
    specifier === "./Cargo.toml"
  ) {
    build();
  }
});

await build();

dev({
  baseUrl: import.meta.url,
});
