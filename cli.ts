import { createHtml } from './html.ts'
import log from './log.ts'
import { getContentType } from './server/mime.ts'
import { listenAndServe, path, ServerRequest, walk } from './std.ts'
import util from './util.ts'
import { version } from './version.ts'

const commands = ['init', 'fetch', 'dev', 'start', 'build']
const helpMessage = `Aleph.js v${version}
The radical new Front-End Framework in deno.

Docs: https://alephjs.org/docs
Bugs: https://github.com/postui/aleph.js/issues

Usage:
    aleph <command> [...options]

Commands:
    ${commands.join(', ')}

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

    // prints aleph.js version
    if (argOptions.v) {
        console.log(`aleph.js v${version}`)
        Deno.exit(0)
    }

    // prints aleph.js and deno version
    if (argOptions.version) {
        const { deno, v8, typescript } = Deno.version
        console.log(`aleph.js ${version}`)
        console.log(`deno ${deno}`)
        console.log(`v8 ${v8}`)
        console.log(`typescript ${typescript}`)
        Deno.exit(0)
    }

    // prints help message
    const hasCommand = args.length > 0 && commands.includes(args[0])
    if (argOptions.h || argOptions.help) {
        if (hasCommand) {
            import(`./cli/${args.shift()}.ts`).then(({ helpMessage }) => {
                console.log(`Aleph.js v${version}`)
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
    const l = argOptions.l || argOptions.log
    if (util.isNEString(l)) {
        log.setLevel(l)
    }

    // proxy https://deno.land/x/aleph
    if (util.existsFile('./import_map.json')) {
        const { imports } = JSON.parse(Deno.readTextFileSync('./import_map.json'))
        Object.assign(globalThis, { ALEPH_IMPORT_MAP: { imports } })
        if (imports['https://deno.land/x/aleph/']) {
            const match = String(imports['https://deno.land/x/aleph/']).match(/^http:\/\/(localhost|127.0.0.1):(\d+)\/$/)
            if (match) {
                const port = parseInt(match[2])
                listenAndServe({ port }, async (req: ServerRequest) => {
                    try {
                        const url = new URL('http://localhost' + req.url)
                        let filepath = path.join(Deno.cwd(), url.pathname)
                        const info = await Deno.lstat(filepath)
                        if (info.isDirectory) {
                            const r = Deno.readDir(filepath)
                            const items: string[] = []
                            for await (const item of r) {
                                if (!item.name.startsWith('.')) {
                                    items.push(`<li><a href='${path.join(url.pathname, encodeURI(item.name))}'>${item.name}${item.isDirectory ? '/' : ''}<a></li>`)
                                }
                            }
                            req.respond({
                                status: 200,
                                headers: new Headers({
                                    'Content-Type': getContentType('.html'),
                                    'Content-Length': info.size.toString()
                                }),
                                body: createHtml({
                                    head: [`<title>aleph.js/</title>`],
                                    body: `<h1>&nbsp;aleph.js/</h1><ul>${Array.from(items).join('')}</ul>`
                                })
                            })
                            return
                        }
                        req.respond({
                            status: 200,
                            headers: new Headers({ 'Content-Type': getContentType(filepath) }),
                            body: await Deno.readFile(filepath)
                        })
                    } catch (err) {
                        if (err instanceof Deno.errors.NotFound) {
                            req.respond({
                                status: 404,
                                body: 'not found'
                            })
                            return
                        }
                        req.respond({
                            status: 500,
                            body: err.message
                        })
                    }
                })
                log.info(`Proxy https://deno.land/x/aleph on http://localhost:${port}`)
            }
        }
    }

    if (!hasCommand) {
        const walkOptions = { includeDirs: false, exts: ['.js', '.jsx', '.mjs', '.ts', '.tsx'], skip: [/\.d\.ts$/i], dep: 1 }
        const pagesDir = path.join(path.resolve(args[0] || '.'), 'pages')
        let hasIndexPage = false
        if (util.existsDir(pagesDir)) {
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

    // execute command
    const command = hasCommand ? args.shift() : 'dev'
    import(`./cli/${command}.ts`).then(({ default: cmd }) => {
        const appDir = path.resolve(args[0] || '.')
        if (command !== 'init' && !util.existsDir(appDir)) {
            log.fatal('No such app directory:', appDir)
        }
        cmd(appDir, argOptions)
    })
}

if (import.meta.main) {
    main()
}
