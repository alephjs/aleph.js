import log from '../log.ts'

export const helpMessage = `
Usage:
    aleph dev <dir> [...options]

<dir> represents the directory of the aleph app,
if the <dir> is empty, the current directory will be used.

Options:
    -p, --port    A port number to start the aleph app, default is 8080
    -r, --reload  Reload source code cache
    -l, --log     Sets log level ['debug', 'info', 'warn', 'error', 'fatal']
    -h, --help    Prints help message
`

export default async function (appDir: string, options: Record<string, string | boolean>) {
    const { start } = await import('../server.ts')
    const port = parseInt(String(options.p || options.port || '8080'))
    if (isNaN(port) || port <= 0 || !Number.isInteger(port)) {
        log.error(`invalid port '${options.port || options.p}'`)
        Deno.exit(1)
    }
    start(appDir, port, true, Boolean(options.r || options.reload))
}
