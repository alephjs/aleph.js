import { Appliaction, parsePortNumber, serve } from '../server/mod.ts'

export const helpMessage = `
Usage:
    aleph dev <dir> [...options]

<dir> represents the directory of Aleph.js app,
if the <dir> is empty, the current directory will be used.

Options:
    -p, --port      <port>       A port number to start the Aleph.js app, default is 8080
    -L, --log-level <log-level>  Set log level [possible values: debug, info]
    -r, --reload                 Reload source code cache
    -h, --help                   Prints help message
`

export default async function (workingDir: string, options: Record<string, string | boolean>) {
    const port = parsePortNumber(String(options.p || options.port || '8080'))
    const app = new Appliaction(workingDir, 'development', Boolean(options.r || options.reload))
    serve('localhost', port, app)
}
