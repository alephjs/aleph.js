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
    await Deno.copyFile('./pkg/aleph_compiler.js', './dist/wasm-pack.js')
}
