// custom script for https://deno.land/x/publish

import { defaultReactVersion } from './shared/constants.ts'

export async function prepublish(version: string) {
  const p = Deno.run({
    cmd: ['deno', 'run', '-A', 'build.ts'],
    cwd: './compiler',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const { success } = await p.status()
  if (success) {
    const data = await Deno.readTextFile('./import_map.json')
    const importMap = JSON.parse(data)
    Object.assign(importMap.imports, {
      'framework': `https://deno.land/x/aleph@v${version}/framework/core/mod.ts`,
      'framework:react': `https://deno.land/x/aleph@v${version}/framework/react/mod.ts`,
      'react': `https://esm.sh/react@${defaultReactVersion}`,
      'react-dom': `https://esm.sh/react-dom@${defaultReactVersion}`
    })
    await Deno.writeTextFile(
      './import_map.json',
      JSON.stringify(importMap, undefined, 2)
    )
  }
  p.close()
  return success
}
