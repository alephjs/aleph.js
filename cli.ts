import { bold } from 'https://deno.land/std@0.106.0/fmt/colors.ts'
import { basename, resolve } from 'https://deno.land/std@0.106.0/path/mod.ts'
import { parse } from 'https://deno.land/std@0.106.0/flags/mod.ts'
import { loadImportMap } from './server/config.ts'
import { existsDir, findFile } from './shared/fs.ts'
import log from './shared/log.ts'
import util from './shared/util.ts'
import { VERSION } from './version.ts'

const commands = {
  'init': 'Create a new app',
  'dev': 'Start the app in development mode',
  'start': 'Start the app in production mode',
  'build': 'Build the app to a static site (SSG)',
  'analyze': 'Analyze the app deps',
  'upgrade': 'Upgrade Aleph.js command'
}

const helpMessage = `Aleph.js v${VERSION}
The Full-stack Framework in Deno.

Docs: https://alephjs.org/docs
Bugs: https://github.com/alephjs/aleph.js/issues

Usage:
    aleph <command> [...options]

Commands:
    ${Object.entries(commands).map(([name, desc]) => `${name.padEnd(15)}${desc}`)
    .join('\n    ')
  }

Options:
    -v, --version  Prints version number
    -h, --help     Prints help message
`

async function main() {
  const { _: args, ...options } = parse(Deno.args)

  // prints aleph.js version
  if (options.v) {
    console.log(`aleph.js v${VERSION}`)
    Deno.exit(0)
  }

  // prints aleph.js and deno version
  if (options.version) {
    const { deno, v8, typescript } = Deno.version
    console.log([
      `aleph.js ${VERSION}`,
      `deno ${deno}`,
      `v8 ${v8}`,
      `typescript ${typescript}`,
    ].join('\n'))
    Deno.exit(0)
  }

  // prints help message when the command not found
  if (!(args.length > 0 && args[0] in commands)) {
    console.log(helpMessage)
    Deno.exit(0)
  }

  const command = String(args.shift()) as keyof typeof commands

  // prints command help message
  if (options.h || options.help) {
    const { helpMessage: cmdHelpMessage } = await import(`./commands/${command}.ts`)
    console.log(commands[command])
    console.log(cmdHelpMessage)
    Deno.exit(0)
  }

  // execute `init` command
  if (command === 'init') {
    const { default: init } = await import(`./commands/init.ts`)
    await init(options?.template, args[0])
    return
  }

  // execute `upgrade` command
  if (command === 'upgrade') {
    const { default: upgrade } = await import(`./commands/upgrade.ts`)
    await upgrade(options.v || options.version || args[0] || 'latest')
    return
  }

  // check working dir
  const workingDir = resolve(String(args[0] || '.'))
  if (!await existsDir(workingDir)) {
    log.fatal('No such directory:', workingDir)
  }

  // run the command if import maps exists
  const importMapFile = await findFile(workingDir, ['import_map', 'import-map', 'importmap', 'importMap'].map(name => `${name}.json`))
  if (importMapFile) {
    const importMap = await loadImportMap(importMapFile)
    let updateImportMaps: boolean | null = null
    let verison = VERSION
    for (const key in importMap.imports) {
      const url = importMap.imports[key]
      if (/\/\/deno\.land\/x\/aleph@v?\d+\.\d+\.\d+(-[a-z0-9\.]+)?\//.test(url)) {
        const [prefix, rest] = util.splitBy(url, '@')
        const [ver, suffix] = util.splitBy(rest, '/')
        if (ver !== 'v' + VERSION && updateImportMaps === null) {
          updateImportMaps = confirm(`You are using a different version of Aleph.js, expect ${ver} -> v${bold(VERSION)}, update '${basename(importMapFile)}'?`)
          if (!updateImportMaps) {
            verison = ver.slice(1)
          }
        }
        if (updateImportMaps) {
          importMap.imports[key] = `${prefix}@v${VERSION}/${suffix}`
        }
      }
    }
    if (updateImportMaps) {
      await Deno.writeTextFile(importMapFile, JSON.stringify(importMap, undefined, 2))
    }
    await run(command, verison, importMapFile)
    return
  }

  // run the command without import maps
  await run(command, VERSION)
}

async function run(name: string, version: string, importMap?: string) {
  const cmd: string[] = [
    Deno.execPath(),
    'run',
    '-A',
    '--unstable',
    '--no-check',
    '--location', 'http://localhost/'
  ]
  if (importMap) {
    cmd.push('--import-map', importMap)
  }
  if (Deno.env.get('ALEPH_DEV') && version === VERSION) {
    cmd.push(`./commands/${name}.ts`)
  } else {
    cmd.push(`https://deno.land/x/aleph@v${version}/commands/${name}.ts`)
  }
  cmd.push(...Deno.args.slice(1))
  const p = Deno.run({
    cmd,
    stdout: 'inherit',
    stderr: 'inherit'
  })
  const c = await p.status()
  p.close()
}

if (import.meta.main) {
  main()
}
