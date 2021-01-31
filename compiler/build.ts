import { base64, brotli, ensureDir, Sha1 } from '../deps.ts'

if (import.meta.main) {
    const p = Deno.run({
        cmd: ['wasm-pack', 'build', '--target', 'web'],
        stdout: 'inherit',
        stderr: 'inherit'
    })
    await p.status()
    p.close()

    const wasmData = await Deno.readFile('./pkg/aleph_compiler_bg.wasm')
    const wpjsContent = await Deno.readTextFile('./pkg/aleph_compiler.js')
    const data = brotli.compress(wasmData)
    const data64 = base64.encode(data)
    const hash = (new Sha1).update(data).hex()
    await ensureDir('./dist')
    await Deno.writeTextFile(
        './dist/wasm.js',
        [
            `import { base64, brotli } from "../../deps.ts";`,
            `const dataRaw = "${data64}";`,
            `export default () => brotli.decompress(base64.decode(dataRaw))`
        ].join('\n')
    )
    await Deno.writeTextFile(
        './dist/wasm-checksum.js',
        `export const checksum = ${JSON.stringify(hash)}`
    )
    await Deno.writeTextFile(
        './dist/wasm-pack.js',
        `import log from "../../shared/log.ts";` + wpjsContent.replace('console.error(getStringFromWasm0(arg0, arg1));', `
            const msg = getStringFromWasm0(arg0, arg1);
            if (msg.includes("DiagnosticBuffer")) {
                const diagnostic = msg.split('DiagnosticBuffer(["')[1].split('"])')[0]
                log.error("swc:", diagnostic)
            } else {
                log.error(msg)
            }
        ` )
    )
}
