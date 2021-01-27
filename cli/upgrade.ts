import { colors } from '../deps.ts'
import { VERSION } from '../version.ts'

export const helpMessage = `
Usage:
    aleph upgrade

Options:
    -v, --version <version>  The upgrading version
    -h, --help               Prints help message
`

async function run(...cmd: string[]) {
    const p = Deno.run({
        cmd,
        stdout: 'null',
        stderr: 'piped'
    })
    Deno.stderr.write(await p.stderrOutput())
    p.close()
}

export default async function (version: string) {
    console.log('Looking up latest version...')
    const { latest, versions } = await (await fetch('https://cdn.deno.land/aleph/meta/versions.json')).json()
    if (version === 'latest') {
        version = latest
    } else if (!versions.includes(version)) {
        version = 'v' + version
        if (!versions.includes(version)) {
            console.log(`${colors.red('error')}: version(${version}) not found!`)
            Deno.exit(1)
        }
    }
    if (version === 'v' + VERSION) {
        console.log('Already up-to-date!')
        Deno.exit(0)
    }
    await run('deno', 'install', '-A', '-f', '-n', 'aleph', `https://deno.land/x/aleph@${version}/cli.ts`)
    console.log(`Aleph.js is up to ${version}!`)
    Deno.exit(0)
}
