import { fromFileUrl } from "std/path/mod.ts";
import dev, { createWatchFsEmitter } from "aleph/dev";

const emitter = createWatchFsEmitter();
emitter.on("modify", ({ specifier }) => {
  if (specifier.endsWith(".rs")) {
    // rebuild the leptos app then restart the dev server
    start();
  }
});

let buildProc: Deno.Process | null = null;

// build the leptos app then start the dev server
async function start() {
  const cwd = fromFileUrl(new URL(".", import.meta.url));
  if (buildProc) {
    buildProc.kill("SIGTERM");
    buildProc.close();
  }
  buildProc = Deno.run({
    cmd: ["wasm-pack", "build", "--target", "web"],
    stdout: "inherit",
    stderr: "inherit",
    cwd,
  });
  try {
    await buildProc.status();
    buildProc.close();
    await Deno.remove(`${cwd}/pkg/.gitignore`);
    // start aleph dev server
    dev({ baseUrl: import.meta.url });
  } finally {
    buildProc = null;
  }
}

start();
