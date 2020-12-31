import { compile, CompileOptions } from 'https://deno.land/x/aleph@v0.2.27/tsc/compile.ts';
import { colors, path, Sha1, walk } from '../deps.ts';
import { initWasm, transpileSync } from './mod.ts';

const hashShort = 9
const reHttp = /^https?:\/\//i

function tsc(source: string, opts: any) {
    const compileOptions: CompileOptions = {
        mode: opts.isDev ? 'development' : 'production',
        target: 'es2020',
        reactRefresh: opts.isDev,
        rewriteImportPath: (path: string) => path.replace(reHttp, '/-/'),
        signUseDeno: (id: string) => {
            const sig = 'useDeno.' + (new Sha1()).update(id).update("0.2.25").update(Date.now().toString()).hex().slice(0, hashShort)
            return sig
        }
    }
    compile(opts.filename, source, compileOptions)
}

/**
 * colored diff
 * - red: 0.0 - 1.0 slower
 * - yellow: 1.0 - 10.0 faster
 * - green: >= 10.0 faster as expected
 */
function coloredDiff(d: number) {
    let cf = colors.green
    if (d < 1) {
        cf = colors.red
    } else if (d < 10) {
        cf = colors.yellow
    }
    return cf(d.toFixed(2) + 'x')
}

async function banchmark(sourceFiles: Array<{ code: string, filename: string }>, isDev: boolean) {
    console.log(`[banchmark] ${sourceFiles.length} files ${isDev ? '(development mode)' : ''}`)

    const d1 = { d: 0, min: 0, max: 0, }
    for (const { code, filename } of sourceFiles) {
        const t = performance.now()
        for (let i = 0; i < 2; i++) {
            tsc(code, { filename, isDev })
        }
        const d = (performance.now() - t) / 2
        if (d1.min === 0 || d < d1.min) {
            d1.min = d
        }
        if (d > d1.max) {
            d1.max = d
        }
        d1.d += d
    }

    const d2 = { d: 0, min: 0, max: 0, }
    for (const { code, filename } of sourceFiles) {
        const t = performance.now()
        for (let i = 0; i < 2; i++) {
            transpileSync(code, { url: filename, swcOptions: {}, isDev })
        }
        const d = (performance.now() - t) / 2
        if (d2.min === 0 || d < d2.min) {
            d2.min = d
        }
        if (d > d2.max) {
            d2.max = d
        }
        d2.d += d
    }

    console.log(`tsc done in ${(d1.d / 1000).toFixed(2)}s, min in ${d1.min.toFixed(2)}ms, max in ${d1.max.toFixed(2)}ms`)
    console.log(`swc done in ${(d2.d / 1000).toFixed(2)}s, min in ${d2.min.toFixed(2)}ms, max in ${d2.max.toFixed(2)}ms`)
    console.log(`swc is ${coloredDiff(d1.d / d2.d)} ${d1.d > d2.d ? 'faster' : 'slower'} than tsc`)
}

if (import.meta.main) {
    (async () => {
        const p = Deno.run({
            cmd: ['deno', 'info'],
            stdout: 'piped',
            stderr: 'null'
        })
        await initWasm((new TextDecoder).decode(await p.output()).split('"')[1])

        const sourceFiles: Array<{ code: string, filename: string }> = []
        const walkOptions = { includeDirs: false, exts: ['.tsx'], skip: [/[\._]test\.tsx?$/i] }
        for await (const { path: filename } of walk(path.resolve('..'), walkOptions)) {
            sourceFiles.push({ code: await Deno.readTextFile(filename), filename })
        }

        banchmark(sourceFiles, false)
        banchmark(sourceFiles, true)
    })()
}
