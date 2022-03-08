import { dim } from "https://deno.land/std@0.128.0/fmt/colors.ts";
import { encode } from "https://deno.land/std@0.128.0/encoding/base64.ts";
import { ensureDir } from "https://deno.land/std@0.128.0/fs/ensure_dir.ts";
import { dirname } from "https://deno.land/std@0.128.0/path/mod.ts";
import { compress } from "https://deno.land/x/brotli@v0.1.4/mod.ts";

async function run(cmd: string[]) {
  const p = Deno.run({
    cmd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await p.status();
  p.close();
  return status.success;
}

Deno.chdir(dirname(new URL(import.meta.url).pathname));

if (import.meta.main) {
  const ok = await run(["wasm-pack", "build", "--target", "web"]);
  if (ok) {
    let prevWasmSize: number;
    try {
      prevWasmSize = (await Deno.stat("./dist/wasm.js")).size;
    } catch (_e) {
      prevWasmSize = 0;
    }
    const wasmData = await Deno.readFile("./pkg/aleph_compiler_bg.wasm");
    const jsCode = await Deno.readTextFile("./pkg/aleph_compiler.js");
    await ensureDir("./dist");
    await Deno.writeTextFile(
      "./dist/wasm.js",
      `import { decompress } from "https://deno.land/x/brotli@v0.1.4/mod.ts";\nexport default () => decompress(Uint8Array.from(atob("${
        encode(compress(wasmData))
      }"), c => c.charCodeAt(0)));`,
    );
    await Deno.writeTextFile(
      "./dist/compiler.js",
      "import { red } from 'https://deno.land/std@0.128.0/fmt/colors.ts';" +
        jsCode
          .replace(`import * as __wbg_star0 from 'env';`, "")
          .replace(`imports['env'] = __wbg_star0;`, `imports['env'] = { now: () => Date.now() };`)
          .replace(
            "console.error(getStringFromWasm0(arg0, arg1));",
            `
              const msg = getStringFromWasm0(arg0, arg1);
              if (msg.includes('DiagnosticBuffer(["')) {
                const diagnostic = msg.split('DiagnosticBuffer(["')[1].split('"])')[0]
                console.error(red("ERROR"), "swc:", diagnostic)
              } else {
                console.error(red("ERROR"), msg)
              }
            `,
          ),
    );
    await run(["deno", "fmt", "-q", "./dist/compiler.js"]);
    const wasmSize = (await Deno.stat("./dist/wasm.js")).size;
    const changed = ((wasmSize - prevWasmSize) / prevWasmSize) * 100;
    if (changed) {
      console.log(
        `${dim("[INFO]")}: wasm.js ${changed < 0 ? "-" : "+"}${Math.abs(changed).toFixed(2)}% (${
          [prevWasmSize, wasmSize].filter(Boolean).map((n) => (n / (1024 * 1024)).toFixed(2) + "MB")
            .join(" -> ")
        })`,
      );
    }
  }
}
