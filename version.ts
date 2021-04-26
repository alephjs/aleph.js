// version managed by https://deno.land/x/publish

export const VERSION = '0.3.0-alpha.32'

export async function prepublish(version: string) {
  const p = Deno.run({
    cmd: ['deno', 'run', '-A', 'build.ts'],
    cwd: './compiler',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const { success } = await p.status()
  p.close()
  return success
}
