import { base64, brotli } from '../deps.ts'

export async function run(...cmd: string[]) {
    const p = Deno.run({
        cmd,
        stdout: 'inherit',
        stderr: 'inherit'
    })
    await p.status()
    p.close()
}

async function build() {
    await run('wasm-pack', 'build', '--target', 'web')
    const wasmData = await Deno.readFile('./pkg/aleph_swc_bg.wasm')
    const data = brotli.compress(wasmData)
    const dataStr = base64.encode(data)
    await Deno.writeTextFile('./aleph_swc_wasm.js', [
        `import { base64, brotli } from '../deps.ts';`,
        `const dataRaw = '${dataStr}';`,
        `export default () => brotli.decompress(base64.decode(dataRaw))`
    ].join('\n'))
    await Deno.copyFile('./pkg/aleph_swc.js', './aleph_swc.js')
}

if (import.meta.main) {
    build()
}
