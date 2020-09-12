import { start } from '../server/server.ts'

export const helpMessage = `Starts the postjs app in development mode.

Usage:
    deno -A run https://alephjs.org/cli.ts dev <dir> [...options]

<dir> represents the directory of the postjs app,
if the <dir> is empty, the current directory will be used.

Options:
    -p, --port  A port number to start the postjs app, default is 8080
    -h, --help  Prints help message
`

export default function (appDir: string, options: Record<string, string | boolean>) {
    start(appDir, parseInt(String(options.port || options.p)) || 8080, true)
}
