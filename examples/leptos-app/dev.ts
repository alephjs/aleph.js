import { fromFileUrl } from "std/path/mod.ts";
import dev, { createWatchFsEmitter } from "aleph/dev";

const emitter = createWatchFsEmitter();
emitter.on("modify", ({ specifier }) => {
  if (specifier.endsWith(".rs")) {
    // rebuild the leptos app then restart the dev server
    start();
  }
});

let buildClientProc: Deno.Process | null = null;
let buildServerProc: Deno.Process | null = null;

// build the leptos app then start the dev server
async function start() {
  const cwd = fromFileUrl(new URL(".", import.meta.url));
  if (buildServerProc) {
    buildServerProc.kill("SIGTERM");
    buildServerProc.close();
  }
  if (buildClientProc) {
    buildClientProc.kill("SIGTERM");
    buildClientProc.close();
  }
  buildServerProc = Deno.run({
    cmd: [
      "wasm-pack",
      "build",
      "--target",
      "web",
      "--out-name",
      "server",
      "--features",
      "ssr",
    ],
    stdout: "inherit",
    stderr: "inherit",
    cwd,
  });
  buildClientProc = Deno.run({
    cmd: [
      "wasm-pack",
      "build",
      "--target",
      "web",
      "--out-name",
      "client",
      "--features",
      "hydrate",
    ],
    stdout: "inherit",
    stderr: "inherit",
    cwd,
  });
  try {
    await buildServerProc.status();
    await buildClientProc.status();
    buildServerProc.close();
    buildClientProc.close();
    await Deno.remove(`${cwd}/pkg/.gitignore`);
    // start aleph dev server
    dev({ baseUrl: import.meta.url });
  } finally {
    buildServerProc = null;
    buildClientProc = null;
  }
}

start();
