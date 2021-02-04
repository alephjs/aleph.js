import { Application, serve } from '../server/mod.ts'
import { parsePortNumber } from '../server/util.ts'

export const helpMessage = `
Usage:
    aleph start <dir> [...options]

<dir> represents the directory of the aleph.js app,
if the <dir> is empty, the current directory will be used.

Options:
    -hn, --hostname <hostname>   The address at which the server is to be started
    -p, --port      <port>       A port number to start the aleph.js app, default is 8080
    -L, --log-level <log-level>  Set log level [possible values: debug, info]
    -r, --reload                 Reload source code cache
    -h, --help                   Prints help message
`

export default async function (workingDir: string, options: Record<string, string | boolean>) {
  const host = String(options.hn || options.hostname || 'localhost')
  const port = parsePortNumber(String(options.p || options.port || '8080'))
  const app = new Application(workingDir, 'production', Boolean(options.r || options.reload))
  serve(host, port, app)
}
