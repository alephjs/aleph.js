import { red } from 'https://deno.land/std@0.90.0/fmt/colors.ts'
import { dirname, join } from 'https://deno.land/std@0.90.0/path/mod.ts'
import { existsFileSync } from '../shared/fs.ts'

const versionMetaUrl = 'https://cdn.deno.land/aleph/meta/versions.json'

export const helpMessage = `
Usage:
    aleph upgrade

Options:
        --version <version>  The version to upgrade to
    -h, --help               Prints help message
`

export default async function (version = 'latest') {
  console.log('Looking up latest version...')
  const { latest, versions } = await (await fetch(versionMetaUrl)).json()
  if (version === 'latest') {
    version = latest
  } else if (!versions.includes(version)) {
    version = 'v' + version
    if (!versions.includes(version)) {
      console.log(`${red('error')}: version(${version}) not found!`)
      Deno.exit(1)
    }
  }

  const denoExecPath = Deno.execPath()
  const cmdExists = existsFileSync(join(dirname(denoExecPath), 'aleph'))
  const p = Deno.run({
    cmd: [
      denoExecPath,
      'install',
      '-A',
      '-f',
      '--unstable',
      '-n', 'aleph',
      '--location', 'https://deno.land/x/aleph',
      '--import-map', 'https://deno.land/x/aleph@{version}/import_map.json',
      `https://deno.land/x/aleph@${version}/cli.ts`
    ],
    stdout: 'null',
    stderr: 'inherit'
  })
  const status = await p.status()
  if (status.success) {
    if (cmdExists) {
      console.log(`Aleph.js is up to ${version}`)
    } else {
      console.log('Aleph.js was installed successfully')
      console.log(`Run 'aleph --help' to get started`)
    }
  }
  Deno.exit(status.code)
}
