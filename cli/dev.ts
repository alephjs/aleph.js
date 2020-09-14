import { start } from '../server/server.ts'

export const helpMessage = `Starts the aleph app in development mode.

Usage:
    aleph dev <dir> [...options]

<dir> represents the directory of the aleph app,
if the <dir> is empty, the current directory will be used.

Options:
    -p, --port  A port number to start the aleph app, default is 8080
    -h, --help  Prints help message
    -l, --log   Sets log level
`

export default function (appDir: string, options: Record<string, string | boolean>) {
    start(appDir, parseInt(String(options.port || options.p)) || 8080, true)
}
