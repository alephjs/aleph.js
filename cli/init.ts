import { ensureDir, ensureFile, fromStreamReader, gzipDecode, path, Untar } from '../deps.ts'
import util from '../util.ts'

export const helpMessage = `Initiate a new aleph app.

Usage:
    aleph init <dir> [...options]

<dir> represents the directory of the aleph app,
if the <dir> is empty, the current directory will be used.

Options:
    -h, --help  Prints help message
    -l, --log   Sets log level
`

export default async function (appDir: string, options: Record<string, string | boolean>) {
    const resp = await fetch('https://codeload.github.com/postui/aleph-templates/tar.gz/master')
    const gzData = await Deno.readAll(fromStreamReader(resp.body!.getReader()))
    const tarData = gzipDecode(gzData)
    const entryList = new Untar(new Deno.Buffer(tarData))
    // todo: add template select ui
    let template = 'hello-world'
    for await (const entry of entryList) {
        if (entry.fileName.startsWith(`aleph-templates-master/${template}/`)) {
            const fp = path.join(appDir, util.trimPrefix(entry.fileName, `aleph-templates-master/${template}/`))
            if (entry.type === 'directory') {
                await ensureDir(fp)
                continue
            }
            await ensureFile(fp)
            const file = await Deno.open(fp, { write: true })
            await Deno.copy(entry, file)
        }
    }
    Deno.exit(0)
}
