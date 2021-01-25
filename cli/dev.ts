import log from '../server/log.ts'
import { start } from '../server/server.ts'

export const helpMessage = `
Usage:
    aleph dev <dir> [...options]

<dir> represents the directory of Aleph.js app,
if the <dir> is empty, the current directory will be used.

Options:
    -h, --host       A host to start the Aleph.js app, default is localhost
    -p, --port       A port number to start the Aleph.js app, default is 8080
    -L, --log-level  Set log level [possible values: debug, info]
    -r, --reload     Reload source code cache
    -h, --help       Prints help message
`

export default async function (appDir: string, options: Record<string, string | boolean>) {
    const host = String(options.h || options.host || 'localhost')
    const port = parseInt(String(options.p || options.port || '8080'))
    
    if (isNaN(port) || port <= 0 || !Number.isInteger(port)) {
        log.error(`invalid port '${options.port || options.p}'`)
        Deno.exit(1)
    }
    
    start(appDir, host, port, true, Boolean(options.r || options.reload))
}
