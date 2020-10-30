import * as colors from 'https://deno.land/std@0.75.0/fmt/colors.ts'
import init, { transformSync } from './pkg/aleph_swc.js'

const wasmCode = Deno.readFileSync('./pkg/aleph_swc_bg.wasm')
await init(wasmCode)

function test(srouce: string, opts: any) {
    const { code } = transformSync(srouce, opts)
    console.log(colors.dim(`[${opts.filename}]`))
    console.log(code.trim() + '\n')
}

test(`
const n: number = 123
if (true) { console.log(n) }
`, { filename: './test.ts' })

test(`
const n: number = 123
if (true) { console.log(n) }
`, { filename: './test.ts', config: { minify: true } })

test(`
<div>Hello World!</div>
`, { filename: './test.jsx' })

test(`
<div className="title">Hello World!</div>
`, { filename: './test.jsx', config: { minify: true } })

test(`
<Import from="./foo.ts" />
`, { filename: './test.jsx' })
