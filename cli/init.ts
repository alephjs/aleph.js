import { gzipDecode } from 'https://deno.land/x/wasm_gzip@v1.0.0/mod.ts'
import log from '../log.ts'
import { colors, ensureDir, ensureFile, fromStreamReader, path, Untar } from '../std.ts'
import util from '../util.ts'

export const helpMessage = `Initiate a new aleph app.

Usage:
    aleph init <dir> [...options]

<dir> represents the directory of the aleph app,
if the <dir> is empty, the current directory will be used.

Options:
    -h, --help  Prints help message
`

export default async function (appDir: string, options: Record<string, string | boolean>) {
    const rev = 'master'
    log.info('Downloading template...')
    const resp = await fetch('https://codeload.github.com/postui/alephjs-templates/tar.gz/' + rev)
    log.info('Saving template...')
    const gzData = await Deno.readAll(fromStreamReader(resp.body!.getReader()))
    const tarData = gzipDecode(gzData)
    const entryList = new Untar(new Deno.Buffer(tarData))

    // todo: add template select ui
    let template = 'hello-world'
    for await (const entry of entryList) {
        if (entry.fileName.startsWith(`alephjs-templates-${rev}/${template}/`)) {
            const fp = path.join(appDir, util.trimPrefix(entry.fileName, `alephjs-templates-${rev}/${template}/`))
            if (entry.type === 'directory') {
                await ensureDir(fp)
                continue
            }
            await ensureFile(fp)
            const file = await Deno.open(fp, { write: true })
            await Deno.copy(entry, file)
        }
    }

    log.info('Done')
    log.info('---')
    log.info(`start(dev): ` + colors.bold(`aleph`) + ' dev ' + path.basename(appDir))
    log.info(`start(prod): ` + colors.bold(`aleph`) + ' start ' + path.basename(appDir))
    log.info(`build(prod): ` + colors.bold(`aleph`) + ' build ' + path.basename(appDir))
    log.info('---')
    Deno.exit(0)
}
