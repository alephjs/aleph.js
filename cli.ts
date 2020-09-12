import { existsSync, listenAndServe, path, ServerRequest } from './deps.ts'
import { createHtml } from './html.ts'
import log from './log.ts'
import { getContentType } from './server/mime.ts'
import util from './util.ts'
import { version } from './version.ts'

const commands = ['init', 'fetch', 'dev', 'start', 'build']
const helpMessage = `postjs v${version}
The radical new Front-End Framework with deno.

Docs: https://alephjs.org/docs
Bugs: https://github.com/postui/postjs/issues

Usage:
    deno -A run https://alephjs.org/cli.ts <command> [...options]

Commands:
    ${commands.join(', ')}

Options:
    -h, --help     Prints help message
    -v, --version  Prints version number
`

function main() {
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

    // prints postjs version
    if (argOptions.v) {
        console.log(`postjs v${version}`)
        Deno.exit(0)
    }

    // prints postjs and deno version
    if (argOptions.version) {
        const { deno, v8, typescript } = Deno.version
        console.log(`postjs v${version}\ndeno v${deno}\nv8 v${v8}\ntypescript v${typescript}`)
        Deno.exit(0)
    }

    // prints help message
    const hasCommand = args.length > 0 && commands.includes(args[0])
    if (argOptions.h || argOptions.help) {
        if (hasCommand) {
            import(`./cli/${args.shift()}.ts`).then(({ helpMessage }) => {
                console.log(`postjs v${version}`)
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

    // proxy alephjs.org
    if (existsSync('./import_map.json')) {
        const { imports } = JSON.parse(Deno.readTextFileSync('./import_map.json'))
        Object.assign(globalThis, { POSTJS_IMPORT_MAP: { imports } })
        if (imports['https://alephjs.org/']) {
            const match = String(imports['https://alephjs.org/']).match(/^http:\/\/(localhost|127.0.0.1):(\d+)\/$/)
            if (match) {
                const port = parseInt(match[2])
                listenAndServe({ port }, async (req: ServerRequest) => {
                    const url = new URL('http://localhost' + req.url)

                    if (/^\/react(\-dom)?$/.test(url.pathname)) {
                        const vendorName = path.basename(url.pathname)
                        const env = url.searchParams.get('env') === 'development' ? 'development' : 'production'
                        req.respond({
                            status: 200,
                            headers: new Headers({
                                'Content-Type': 'application/javascript',
                                'X-TypeScript-Types': `/${vendorName}/types/index.d.ts`
                            }),
                            body: [
                                `export * from '/${vendorName}/${vendorName}.${env}.js';`,
                                `export { default } from '/${vendorName}/${vendorName}.${env}.js';`
                            ].join('\n')
                        })
                        return
                    }

                    try {
                        let filepath = path.join(Deno.cwd(), url.pathname)
                        if (/^\/react(\-dom)?\//.test(url.pathname)) {
                            filepath = path.join(Deno.cwd(), 'vendor', url.pathname)
                        }
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
                                    head: [`<title>postjs/</title>`],
                                    body: `<h1>&nbsp;postjs/</h1><ul>${Array.from(items).join('')}</ul>`
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
                log.info(`Start alephjs.org proxy server on http://localhost:${port}`)
            }
        }
    }

    // execute command
    const command = hasCommand ? args.shift() : 'dev'
    import(`./cli/${command}.ts`).then(({ default: cmd }) => {
        const appDir = path.resolve(args[0] || '.')
        if (command !== 'init' && !existsSync(appDir)) {
            log.error('No such app directory:', appDir)
            return
        }
        cmd(appDir, argOptions)
    })
}

if (import.meta.main) {
    main()
}
