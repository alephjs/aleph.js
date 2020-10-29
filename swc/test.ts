import init, { transformSync } from './pkg/aleph_swc.js'

const wasmCode = Deno.readFileSync('./pkg/aleph_swc_bg.wasm')
await init(wasmCode)
const out = transformSync('const n: number = 123', { filename: './test.ts' })
console.log(out)
