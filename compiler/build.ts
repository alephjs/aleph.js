import { encode } from 'std/encoding/base64.ts'
import { ensureDir } from 'std/fs/ensure_dir.ts'
import { createHash } from 'std/hash/mod.ts'
import { compress } from 'brotli'

async function run(cmd: string[]) {
  const p = Deno.run({
    cmd,
    stdout: 'inherit',
    stderr: 'inherit'
  })
  const status = await p.status()
  p.close()
  return status.success
}

if (import.meta.main) {
  if (await run(['wasm-pack', 'build', '--target', 'web'])) {
    const wasmData = await Deno.readFile('./pkg/aleph_compiler_bg.wasm')
    const wasmPackJS = await Deno.readTextFile('./pkg/aleph_compiler.js')
    const data = compress(wasmData)
    const dataBase64 = encode(data)
    const hash = createHash('sha1').update(data).toString()
    await ensureDir('./dist')
    await Deno.writeTextFile(
      './dist/wasm.js',
      [
        `import { decode } from "std/encoding/base64.ts";`,
        `import { decompress } from "brotli";`,
        `const dataRaw = "${dataBase64}";`,
        `export default () => decompress(decode(dataRaw));`
      ].join('\n')
    )
    await Deno.writeTextFile(
      './dist/wasm-checksum.js',
      `export const checksum = ${JSON.stringify(hash)};`
    )
    await Deno.writeTextFile(
      './dist/wasm-pack.js',
      `import { red } from 'std/fmt/colors.ts';` + wasmPackJS.replace('console.error(getStringFromWasm0(arg0, arg1));', `
        const msg = getStringFromWasm0(arg0, arg1);
        if (msg.includes('DiagnosticBuffer(["')) {
          const diagnostic = msg.split('DiagnosticBuffer(["')[1].split('"])')[0]
          console.error(red("ERROR"), "swc:", diagnostic)
        } else {
          console.error(red("ERROR"), msg)
        }
      `)
    )
    await run(['deno', 'fmt', '-q', './dist/wasm-pack.js'])
  }
}
