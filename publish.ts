// custom scripts for deno.land/x/publish

export async function prepublish(version: string) {
    // update the version.ts before re-build the compiler wasm.
    Deno.writeTextFile('./version.ts', `export const VERSION = '${version}'\n`)

    const p = Deno.run({
        cmd: ['deno', 'run', '-A', 'build.ts'],
        cwd: './compiler',
        stdout: 'inherit',
        stderr: 'inherit',
    })
    await p.status()
    p.close()
}
