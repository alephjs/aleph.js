import { serve } from "aleph/server";
import init, { ssr } from "./pkg/yew_app.js";

await init(await Deno.readFile("./pkg/yew_app_bg.wasm"));

async function buildWASM(forceBuild?: boolean) {
  if (forceBuild || !existsFile("./pkg/package.json")) {
    const p = Deno.run({
      cmd: ["wasm-pack", "build", "--target", "web"],
      stdout: "inherit",
      stderr: "inherit",
    });
    await p.status();
    p.close();
  }
}

async function existsFile(path: string): Promise<boolean> {
  try {
    const stat = await Deno.lstat(path);
    return stat.isFile;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false;
    }
    throw err;
  }
}

serve({
  devServer: {
    watchFS: (_kind, specifier) => {
      if (specifier.startsWith("./src/") && specifier.endsWith(".rs")) {
        buildWASM(true);
      }
    },
  },
  build: {
    preBuild: buildWASM,
  },
  ssr: {
    render: (_ctx) => ssr(),
  },
});
