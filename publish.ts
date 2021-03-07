// custom script for deno.land/x/publish

export async function prepublish(version: string) {
  const p = Deno.run({
    cmd: ['deno', 'run', '-A', 'build.ts'],
    cwd: './compiler',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  await p.status()
  p.close()
}
