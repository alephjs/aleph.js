import { dim } from "https://deno.land/std@0.125.0/fmt/colors.ts";
import { encode } from "https://deno.land/std@0.125.0/encoding/base64.ts";
import { ensureDir } from "https://deno.land/std@0.125.0/fs/ensure_dir.ts";
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

if (import.meta.main) {
  const ok = await run(["wasm-pack", "build", "--target", "web"]);
  if (ok) {
    const wasmData = await Deno.readFile("./pkg/aleph_compiler_bg.wasm");
    const jsCode = await Deno.readTextFile("./pkg/aleph_compiler.js");
    let prevWasmSize = 0;
    try {
      prevWasmSize = (await Deno.stat("./dist/wasm.js")).size;
    } catch (e) {}
    await ensureDir("./dist");
    await Deno.writeTextFile(
      "./dist/wasm.js",
      [
        `import { decode } from "https://deno.land/std@0.125.0/encoding/base64.ts";`,
        `import { decompress } from "https://deno.land/x/brotli@v0.1.4/mod.ts";`,
        `const dataRaw = "${encode(compress(wasmData))}";`,
        `export default () => decompress(decode(dataRaw));`,
      ].join("\n"),
    );
    await Deno.writeTextFile(
      "./dist/compiler.js",
      "import { red } from 'https://deno.land/std@0.125.0/fmt/colors.ts';" +
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
    const increased = ((wasmSize - prevWasmSize) / prevWasmSize) * 100;
    if (increased) {
      console.log(
        `${dim("[INFO]")}: wasm.js ${increased.toFixed(2)}% (${
          [prevWasmSize, wasmSize].filter(Boolean).map((n) => (n / (1024 * 1024)).toFixed(2) + "MB")
            .join(" -> ")
        })`,
      );
    }
  }
}
