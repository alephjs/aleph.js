
export const helpMessage = `Fetches the postjs app remote modules.

Usage:
    deno -A run https://alephjs.org/cli.ts fetch <dir> [...options]

<dir> represents the directory of the postjs app,
if the <dir> is empty, the current directory will be used.

Options:
    -h, --help  Prints help message
    -l, --log   Sets log level
`

export default function (appDir: string, options: Record<string, string | boolean>) {

}
