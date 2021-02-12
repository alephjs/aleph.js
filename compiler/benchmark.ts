import { compile, CompileOptions } from 'https://deno.land/x/aleph@v0.2.28/tsc/compile.ts'
import { colors, createHash, path, walk } from '../deps.ts'
import { initWasm, transpileSync } from './mod.ts'

function tsc(source: string, opts: any) {
  const compileOptions: CompileOptions = {
    mode: opts.isDev ? 'development' : 'production',
    target: 'es2020',
    reactRefresh: opts.isDev,
    rewriteImportPath: (path: string) => path.replace('https://', '/-/'),
    signUseDeno: (id: string) => {
      const sig = 'useDeno.' + createHash('sha1').update(id).toString().slice(0, 9)
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
function colorDiff(d: number) {
  let cf = colors.green
  if (d < 1) {
    cf = colors.red
  } else if (d < 10) {
    cf = colors.yellow
  }
  return cf(d.toFixed(2) + 'x')
}

async function benchmark() {
  const sourceFiles: Array<{ code: string, filename: string }> = []
  const walkOptions = { includeDirs: false, exts: ['ts', '.tsx'], skip: [/[\._](test|d)\.tsx?$/i, /\/compiler\//] }
  for await (const { path: filename } of walk(path.resolve('..'), walkOptions)) {
    sourceFiles.push({ code: await Deno.readTextFile(filename), filename })
  }
  console.log(`[benchmark] ${sourceFiles.length} files`)

  const d1 = { d: 0, min: 0, max: 0, }
  const d2 = { d: 0, min: 0, max: 0, }

  for (const { code, filename } of sourceFiles) {
    const t = performance.now()
    tsc(code, { filename, isDev: true })
    const d = (performance.now() - t)
    if (d1.min === 0 || d < d1.min) {
      d1.min = d
    }
    if (d > d1.max) {
      d1.max = d
    }
    d1.d += d
  }
  for (const { code, filename } of sourceFiles) {
    const t = performance.now()
    transpileSync(code, {
      url: filename,
      swcOptions: { target: 'es2020' },
      isDev: true
    })
    const d = (performance.now() - t)
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
  console.log(`swc is ${colorDiff(d1.d / d2.d)} ${d1.d > d2.d ? 'faster' : 'slower'} than tsc`)
}

async function init() {
  const p = Deno.run({
    cmd: [Deno.execPath(), 'info', '--unstable', '--json'],
    stdout: 'piped',
    stderr: 'null'
  })
  const output = (new TextDecoder).decode(await p.output())
  const denoCacheDir = JSON.parse(output).denoDir
  p.close()

  // initiate wasm
  await initWasm(denoCacheDir)

  // wasm warm-up
  transpileSync('console.log("Hello World")', { url: '/test.ts', isDev: true })
}

if (import.meta.main) {
  await init()
  await benchmark()
}
