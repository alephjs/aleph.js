
import Project from '../project.ts'

export const helpMessage = `Builds the postjs app in production mode.

Usage:
    deno -A run https://alephjs.org/cli.ts build <dir> [...options]

<dir> represents the directory of the postjs app,
if the <dir> is empty, the current directory will be used.

Options:
    -h, --help  Prints help message
    -l, --log   Sets log level
`

export default async function (appDir: string, options: Record<string, string | boolean>) {
    const project = new Project(appDir, 'production')
    await project.build()
    Deno.exit(0)
}
