import { listenAndServe, path, walk } from './deps.ts'
import { Request } from './server/api.ts'
import { getContentType } from './server/mime.ts'
import { createHtml } from './server/util.ts'
import { existsDirSync } from './shared/fs.ts'
import type { LevelNames } from './shared/log.ts'
import log from './shared/log.ts'
import util from './shared/util.ts'
import type { ServerRequest } from './types.ts'
import { VERSION } from './version.ts'

const commands = {
  'init': 'Create a new application',
  'dev': 'Start the app in development mode',
  'start': 'Start the app in production mode',
  'build': 'Build the app to a static site (SSG)',
  'upgrade': 'Upgrade Aleph.js command'
}

const helpMessage = `Aleph.js v${VERSION}
The Full-stack Framework in Deno.

Docs: https://alephjs.org/docs
Bugs: https://github.com/alephjs/aleph.js/issues

Usage:
    aleph <command> [...options]

Commands:
    ${Object.entries(commands).map(([name, desc]) => `${name.padEnd(15)}${desc}`).join('\n    ')}

Options:
    -v, --version  Prints version number
    -h, --help     Prints help message
`

async function main() {
  // parse deno args
  const args: Array<string> = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < Deno.args.length; i++) {
    const arg = Deno.args[i]
    if (arg.startsWith('-')) {
      if (arg.includes('=')) {
        const [key, value] = arg.replace(/^-+/, '').split('=', 2)
        flags[key] = value
      } else {
        const key = arg.replace(/^-+/, '')
        const nextArg = Deno.args[i + 1]
        if (nextArg && !nextArg.startsWith('-')) {
          flags[key] = nextArg
          i++
        } else {
          flags[key] = true
        }
      }
    } else {
      args.push(arg)
    }
  }

  const hasCommand = args.length > 0 && args[0] in commands
  const command = (hasCommand ? String(args.shift()) : 'dev') as keyof typeof commands

  // prints aleph.js version
  if (flags.v && command != 'upgrade') {
    console.log(`aleph.js v${VERSION}`)
    Deno.exit(0)
  }

  // prints aleph.js and deno version
  if (flags.version && command != 'upgrade') {
    const { deno, v8, typescript } = Deno.version
    console.log(`aleph.js ${VERSION}`)
    console.log(`deno ${deno}`)
    console.log(`v8 ${v8}`)
    console.log(`typescript ${typescript}`)
    Deno.exit(0)
  }

  // prints help message
  if (flags.h || flags.help) {
    if (hasCommand) {
      import(`./cli/${command}.ts`).then(({ helpMessage }) => {
        console.log(commands[command])
        if (util.isNEString(helpMessage)) {
          console.log(helpMessage)
        }
        Deno.exit(0)
      })
      return
    } else {
      console.log(helpMessage)
      Deno.exit(0)
    }
  }

  // sets log level
  const l = flags.L || flags['log-level']
  if (util.isNEString(l)) {
    log.setLevel(l.toLowerCase() as LevelNames)
  }

  if (!hasCommand && !args[0]) {
    const walkOptions = { includeDirs: false, exts: ['.js', '.jsx', '.mjs', '.ts', '.tsx'], skip: [/\.d\.ts$/i], dep: 1 }
    const pagesDir = path.join(path.resolve('.'), 'pages')
    let hasIndexPage = false
    if (existsDirSync(pagesDir)) {
      for await (const { path: p } of walk(pagesDir, walkOptions)) {
        if (path.basename(p).split('.')[0] === 'index') {
          hasIndexPage = true
        }
      }
    }
    if (!hasIndexPage) {
      console.log(helpMessage)
      Deno.exit(0)
    }
  }

  // load .env
  for await (const { path: p, } of walk(Deno.cwd(), { exts: ['env'], maxDepth: 1 })) {
    const text = await Deno.readTextFile(p)
    text.split('\n').forEach(line => {
      let [key, value] = util.splitBy(line, '=')
      key = key.trim()
      if (key) {
        Deno.env.set(key, value.trim())
      }
    })
    log.debug('load env from', path.basename(p))
  }

  // proxy https://deno.land/x/aleph for aleph.js dev
  const p = Deno.env.get('ALEPH_DEV_PORT')
  if (p && !/^\d+$/.test(p)) {
    log.fatal('invalid ALEPH_DEV_PORT:', p)
  }
  if (p) {
    const cwd = Deno.cwd()
    const port = parseInt(p)
    listenAndServe({ port }, async (req: ServerRequest) => {
      const url = new URL('http://localhost' + req.url)
      const resp = new Request(req, util.cleanPath(url.pathname), {}, url.searchParams)
      const filepath = path.join(cwd, url.pathname)
      try {
        const info = await Deno.lstat(filepath)
        if (info.isDirectory) {
          const r = Deno.readDir(filepath)
          const items: string[] = []
          for await (const item of r) {
            if (!item.name.startsWith('.')) {
              items.push(`<li><a href='${path.join(url.pathname, encodeURI(item.name))}'>${item.name}${item.isDirectory ? '/' : ''}<a></li>`)
            }
          }
          resp.send(createHtml({
            head: [`<title>aleph.js/</title>`],
            body: `<h1>&nbsp;aleph.js/</h1><ul>${Array.from(items).join('')}</ul>`
          }), 'text/html')
          return
        }
        resp.send(await Deno.readFile(filepath), getContentType(filepath))
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
          resp.status(404).send('file not found')
          return
        }
        resp.status(500).send(err.message)
      }
    })
    log.info(`Proxy https://deno.land/x/aleph on http://localhost:${port}`)
  }

  const { default: cmd } = await import(`./cli/${command}.ts`)
  switch (command) {
    case 'init':
      await cmd(args[0])
      break
    case 'upgrade':
      await cmd(flags.v || flags.version || args[0] || 'latest')
      break
    default:
      const appDir = path.resolve(args[0] || '.')
      if (!existsDirSync(appDir)) {
        log.fatal('No such directory:', appDir)
      }
      await cmd(appDir, flags)
      break
  }
}

if (import.meta.main) {
  main()
}
