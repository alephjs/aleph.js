export const helpMessage = `
Usage:
    aleph start <dir> [...options]

<dir> represents the directory of the aleph app,
if the <dir> is empty, the current directory will be used.

Options:
    -p, --port    A port number to start the aleph app, default is 8080
    -r, --reload  Reload remote deps
    -h, --help    Prints help message
`

export default async function (appDir: string, options: Record<string, string | boolean>) {
    const { start } = await import('../server.ts')
    start(appDir, parseInt(String(options.port || options.p)) || 8080)
}
