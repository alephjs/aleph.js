import { start } from '../server.ts'

export const helpMessage = `
Usage:
    aleph dev <dir> [...options]

<dir> represents the directory of the aleph app,
if the <dir> is empty, the current directory will be used.

Options:
    -p, --port    A port number to start the aleph app, default is 8080
    -r, --reload  Reload remote deps
    -l, --log     Sets log level ['debug', 'info', 'warn', 'error', 'fatal']
    -h, --help    Prints help message
`

export default function (appDir: string, options: { port?: string, p?: string }) {
    start(appDir, parseInt(options.port || options.p || '8080') || 8080, true)
}
