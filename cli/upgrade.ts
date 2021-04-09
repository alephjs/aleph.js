import { red } from 'std/fmt/colors.ts'
import { dirname, join } from 'std/path/mod.ts'
import { existsSync } from 'std/fs/exists.ts'
import { VERSION } from '../version.ts'

const versionMetaUrl = 'https://cdn.deno.land/aleph/meta/versions.json'

export const helpMessage = `
Usage:
    aleph upgrade

Options:
        --version <version>  The version to upgrade to
    -h, --help               Prints help message
`

export default async function (version = 'latest', forceUpgrade = false) {
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

  if (version === 'v' + VERSION && !forceUpgrade) {
    console.log('Already up-to-date!')
    Deno.exit(0)
  }

  const denoExecPath = Deno.execPath()
  const cmdExists = existsSync(join(dirname(denoExecPath), 'aleph'))
  const p = Deno.run({
    cmd: [
      denoExecPath,
      'install',
      '-A',
      '-f',
      '--unstable',
      '-n', 'aleph',
      '--location', 'https://deno.land/x/aleph',
      `https://deno.land/x/aleph@${version}/cli.ts`
    ],
    stdout: 'null',
    stderr: 'inherit'
  })
  const status = await p.status()
  if (status.success) {
    if (cmdExists && !forceUpgrade) {
      console.log(`Aleph.js is up to ${version}`)
    } else {
      console.log('Aleph.js was installed successfully')
      console.log(`Run 'aleph -h' to get started`)
    }
  }
  Deno.exit(status.code)
}
