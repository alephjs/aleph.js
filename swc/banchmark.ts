import { colors, path, Sha1, walk } from '../std.ts';
import { compile } from '../tsc/compile.ts';
import { hashShort } from '../util.ts';
import { version } from '../version.ts';
import init, { transformSync } from './pkg/aleph_swc.js';

const wasmCode = Deno.readFileSync('./pkg/aleph_swc_bg.wasm')
await init(wasmCode)

function swc(source: string, opts: any) {
    transformSync(source, opts)
}

function tsc(source: string, opts: any) {
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
    compile(opts.filename, source, compileOptions as any)
}

async function banchmark() {
    const sourceFiles: Array<{ code: string, filename: string }> = []
    const walkOptions = { includeDirs: false, exts: ['.js', '.jsx', '.ts', '.tsx'], skip: [/[\._]aleph\//, /_dist\//, /swc\//, /\.d\.ts$/i, /[\._]test\.(j|t)sx?$/i] }
    for await (const { path: filename } of walk(path.resolve('..'), walkOptions)) {
        sourceFiles.push({ code: await Deno.readTextFile(filename), filename })
    }

    console.log(`[banchmark] ${sourceFiles.length} files`)

    const t = performance.now()
    for (const { code, filename } of sourceFiles) {
        swc(code, { filename })
    }
    const d = performance.now() - t

    const t2 = performance.now()
    for (const { code, filename } of sourceFiles) {
        tsc(code, { filename })
    }
    const d2 = performance.now() - t2

    console.log(`swc done in ${d.toFixed(2)}ms, avg. in ${(d / sourceFiles.length).toFixed(2)}ms`)
    console.log(`tsc done in ${d2.toFixed(2)}ms, avg. in ${(d2 / sourceFiles.length).toFixed(2)}ms`)
    console.log(`swc is ${colors.green((d2 / d).toFixed(2) + 'x')} faster than tsc`)
}

await banchmark()
