
import Project from '../project.ts'

export const helpMessage = `Builds the aleph app in production mode.

Usage:
    aleph build <dir> [...options]

<dir> represents the directory of the aleph app,
if the <dir> is empty, the current directory will be used.

Options:
    -h, --help  Prints help message
`

export default async function (appDir: string, options: Record<string, string | boolean>) {
    const project = new Project(appDir, 'production')
    await project.build()
    Deno.exit(0)
}
