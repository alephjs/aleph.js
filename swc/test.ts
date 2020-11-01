import { colors, Sha1 } from '../std.ts';
import { compile } from '../tsc/compile.ts';
import { hashShort } from '../util.ts';
import { version } from '../version.ts';
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

function tsc(source: string, opts: any, print = true) {
    const compileOptions = {
        mode: opts.swcOptions?.minify ? 'production' : 'development',
        target: opts.swcOptions?.target || 'es2020',
        reactRefresh: !opts.swcOptions?.minify,
        rewriteImportPath: (path: string) => '?',
        signUseDeno: (id: string) => {
            const sig = 'useDeno.' + (new Sha1()).update(id).update(version).update(Date.now().toString()).hex().slice(0, hashShort)
            return sig
        }
    }
    const { outputText } = compile(opts.filename, source, compileOptions as any)
    if (print) {
        console.log(colors.dim(`tsc[${opts.filename}]`))
        console.log(outputText.trim() + '\n')
    }
}

function banchmark(source: string, opts: any) {
    console.log(colors.dim(`\n[banchmark] ${opts.filename} (minify: ${!!opts.swcOptions?.minify})`))
    const N = 100
    const t = performance.now()
    for (let i = 0; i < N; i++) {
        swc(source, opts, false)
    }
    const d = performance.now() - t
    console.log(`swc done in ${d.toFixed(2)}ms, avg. in ${(d / N).toFixed(2)}ms`)

    const t2 = performance.now()
    for (let i = 0; i < N; i++) {
        tsc(source, opts, false)
    }
    const d2 = performance.now() - t2
    console.log(`tsc done in ${d2.toFixed(2)}ms, avg. in ${(d2 / N).toFixed(2)}ms`)

    console.log(`swc is ${colors.green((d2 / d).toFixed(2) + 'x')} faster than tsc`)
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
            <Head>
                <SEO
                    title="Aleph.js"
                    description="The React Framework in Deno."
                    keywords="aleph,aleph.js,react,framework,deno,ssr,ssg,typescript,esm,import-maps,hmr,fast-refresh"
                    image="https://alephjs.org/twitter_card.jpg"
                />
                <meta name="twitter:image" content="https://alephjs.org/twitter_card.jpg" />
                <meta name="twitter:site" content="@alephjs" />
            </Head>
            <Import from="../style/index.less" />
            <div className="fullscreen-page">
                <Import
                    from="../components/logo.tsx"
                    fallback={<PlainLogo />}
                />
                <h1>The React Framework in Deno.</h1>
                <p className="intro"><strong>Aleph.js</strong> gives you the best developer experience on building modern web application:<br /> TypeScript in Deno, ES module imports, file-system routing, SSR & SSG,<br /> HMR with Fast Refresh, and more. No config needed.</p>
                <p className="intro short"><strong>Aleph.js</strong> gives you the best developer experience on building modern web application.</p>
                <div className="buttons">
                    <Link to="/docs/get-started"> <Button strong>Get Started</Button></Link>
                    <Link to="/docs"> <Button strong>Documentation</Button></Link>
                </div>
            </div>
            <section>
                <h2>Features</h2>
                <ul>
                    <li>Zero Config</li>
                    <li>Typescript in Deno</li>
                    <li>ES Module Ready</li>
                    <li>Import Maps</li>
                    <li>HMR with Fast Refresh</li>
                    <li>File-system Routing</li>
                    <li>Markdown Page</li>
                    <li>Built-in CSS(Less) Support</li>
                    <li>SSR & SSG</li>
                </ul>
            </section>
            <footer>
                <p>Copyright © {thisYear} postUI, Lab. All rights reserved.</p>
                <p>Built by Aleph.js - v{version}</p>
                <p>(MIT License)</p>
            </footer>
        </div>
    )
}
`

swc(code, { filename: 'page.tsx' })
banchmark(code, { filename: 'page.tsx' })
banchmark(code, { filename: 'page.tsx', swcOptions: { minify: true } })
banchmark(Deno.readTextFileSync('../project.ts'), { filename: 'project.ts' })
