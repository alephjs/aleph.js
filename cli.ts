import { Request } from './api.ts'
import { existsDirSync, existsFileSync } from './fs.ts'
import { createHtml } from './html.ts'
import log from './log.ts'
import { getContentType } from './mime.ts'
import { listenAndServe, path, ServerRequest, walk } from './std.ts'
import util from './util.ts'
import { version } from './version.ts'

const commands = {
    'init': 'Create a new application',
    'dev': 'Start the app in development mode',
    'start': 'Start the app in production mode',
    'build': 'Build the app to a static site (SSG)',
    'upgrade': 'Upgrade Aleph.js command'
}

const helpMessage = `Aleph.js v${version}
The React Framework in deno.

Docs: https://alephjs.org/docs
Bugs: https://github.com/alephjs/aleph.js/issues

Usage:
    aleph <command> [...options]

Commands:
    ${Object.entries(commands).map(([name, desc]) => `${name.padEnd(15)}${desc}`).join('\n    ')}

Options:
    -h, --help     Prints help message
    -v, --version  Prints version number
`

async function main() {
    // parse deno args
    const args: Array<string> = []
    const argOptions: Record<string, string | boolean> = {}
    for (let i = 0; i < Deno.args.length; i++) {
        const arg = Deno.args[i]
        if (arg.startsWith('-')) {
            if (arg.includes('=')) {
                const [key, value] = arg.replace(/^-+/, '').split('=', 2)
                argOptions[key] = value
            } else {
                const key = arg.replace(/^-+/, '')
                const nextArg = Deno.args[i + 1]
                if (nextArg && !nextArg.startsWith('-')) {
                    argOptions[key] = nextArg
                    i++
                } else {
                    argOptions[key] = true
                }
            }
        } else {
            args.push(arg)
        }
    }

    // get command, default is 'dev'
    const hasCommand = args.length > 0 && args[0] in commands
    const command = (hasCommand ? String(args.shift()) : 'dev') as keyof typeof commands

    // prints aleph.js version
    if (argOptions.v && command != 'upgrade') {
        console.log(`aleph.js v${version}`)
        Deno.exit(0)
    }

    // prints aleph.js and deno version
    if (argOptions.version && command != 'upgrade') {
        const { deno, v8, typescript } = Deno.version
        console.log(`aleph.js ${version}`)
        console.log(`deno ${deno}`)
        console.log(`v8 ${v8}`)
        console.log(`typescript ${typescript}`)
        Deno.exit(0)
    }

    // prints help message
    if (argOptions.h || argOptions.help) {
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
    const l = argOptions.L || argOptions['log-level']
    if (util.isNEString(l)) {
        log.setLevel(l)
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

    // proxy https://deno.land/x/aleph
    if (['dev', 'start', 'build'].includes(command) && existsFileSync('./import_map.json')) {
        const { imports } = JSON.parse(Deno.readTextFileSync('./import_map.json'))
        Object.assign(globalThis, { ALEPH_IMPORT_MAP: { imports } })
        if (imports['https://deno.land/x/aleph/']) {
            const match = String(imports['https://deno.land/x/aleph/']).match(/^http:\/\/(localhost|127.0.0.1):(\d+)\/$/)
            if (match) {
                const cwd = Deno.cwd()
                const port = parseInt(match[2])
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
        }
    }

    const { default: cmd } = await import(`./cli/${command}.ts`)
    if (command === 'upgrade') {
        await cmd(argOptions.v || argOptions.version || 'latest')
    } else {
        const appDir = path.resolve(args[0] || '.')
        if (command !== 'init' && !existsDirSync(appDir)) {
            log.fatal('No such directory:', appDir)
        }
        await cmd(appDir, argOptions)
    }
}

if (import.meta.main) {
    main()
}
