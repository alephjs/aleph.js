import { base64, brotli, createHash, ensureDir } from '../deps.ts'

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
    const data = brotli.compress(wasmData)
    const dataBase64 = base64.encode(data)
    const hash = createHash('sha1').update(data).toString()
    await ensureDir('./dist')
    await Deno.writeTextFile(
      './dist/wasm.js',
      [
        `import { base64, brotli } from "../../deps.ts";`,
        `const dataRaw = "${dataBase64}";`,
        `export default () => brotli.decompress(base64.decode(dataRaw));`
      ].join('\n')
    )
    await Deno.writeTextFile(
      './dist/wasm-checksum.js',
      `export const checksum = ${JSON.stringify(hash)};`
    )
    await Deno.writeTextFile(
      './dist/wasm-pack.js',
      `import log from "../../shared/log.ts";` + wasmPackJS.replace('console.error(getStringFromWasm0(arg0, arg1));', `
        const msg = getStringFromWasm0(arg0, arg1);
        if (msg.includes('DiagnosticBuffer(["')) {
          const diagnostic = msg.split('DiagnosticBuffer(["')[1].split('"])')[0]
          log.error("swc:", diagnostic)
        } else {
          log.error(msg)
        }
      `)
    )
    await run(['deno', 'fmt', '-q', './dist/wasm-pack.js'])
  }
}
