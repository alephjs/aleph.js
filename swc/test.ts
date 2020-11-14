import { colors } from '../std.ts';
import init, { transformSync } from './pkg/aleph_swc.js';

const wasmCode = Deno.readFileSync('./pkg/aleph_swc_bg.wasm')
await init(wasmCode)

function swc(source: string, opts: any, print = true) {
    const { code } = transformSync(source, opts)
    if (print) {
        console.log(colors.dim(`swc[${opts.filename}]`))
        console.log(code.trim() + '\n')
    }
}

const code = `import { Head, Import, Link, SEO, useDeno } from 'https://deno.land/x/aleph/mod.ts'
import React from 'https://esm.sh/react'
import Button from '../components/button.tsx'
import PlainLogo from '../components/plain-logo.tsx'

const thisYear = (new Date).getFullYear()

export default function Home() {
    const { version } = useDeno(() => ({
        version: (window as any).ALEPH.ENV.__version
    }))

    return (
        <div className="index-page">
            <Import from="../style/index.less" />
            <Import
                from="../components/logo.tsx"
                fallback={<PlainLogo />}
            />
            <p className="fullscreen-page">version {version}</p>
        </div>
    )
}
`

swc(code, { filename: 'page.tsx' })
