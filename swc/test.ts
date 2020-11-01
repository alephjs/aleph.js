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
const A = () => {
    useDeno()
    useDeno(123)
    useDeno('abc')
    useDeno(()=>{})
    useDeno(function(){})
    useDeno(async function(){})
    const a = useDeno()
    const b = useDeno(()=>{})
    const c = useDeno(function(){})
    const d = useDeno(async ()=>{})
    const d = useDeno(async function(){})
    const d = useDeno(async function(){}, true)
    const d = useDeno(async function(){}, true, [])
    const d = useDeno(async function(){}, true, [], 'abc')
    const d = useDeno(async function(){}, true, [], 'abc', 123)
    return null
}

function B() {
    const Title = ()=> {
        const e = useDeno(()=>{ return 'Hello World!' })
        return (
            <h1>{e}</h1>
        )
    }
    return (
        <>
        <Import from="../style.css" />
        <Title/>
        </>
    )
}

export const C = () => {
    const d = useDeno(async ()=>{})
    return null
}

export default function D() {
    const d = useDeno(async ()=>{})
    return null
}
`, { filename: '/test.tsx' })
