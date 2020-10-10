export const helpMessage = `
Usage:
    aleph build <dir> [...options]

<dir> represents the directory of the aleph app,
if the <dir> is empty, the current directory will be used.

Options:
    -r, --reload  Reload remote deps
    -h, --help    Prints help message
`

export default async function (appDir: string, options: Record<string, string | boolean>) {
    const { Project } = await import('../project.ts')
    const project = new Project(appDir, 'production')
    await project.build()
    Deno.exit(0)
}
