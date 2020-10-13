import { gzipDecode } from 'https://deno.land/x/wasm_gzip@v1.0.0/mod.ts'
import log from '../log.ts'
import { colors, ensureDir, ensureFile, fromStreamReader, path, Untar } from '../std.ts'
import util from '../util.ts'

const gitignore = [
    '.DS_Store',
    'Thumbs.db',
    '.aleph/',
    'dist/',
]
const vscExtensions = {
    'recommendations': [
        'denoland.vscode-deno'
    ]
}
const vscSettings = {
    'files.eol': '\n',
    'files.trimTrailingWhitespace': true,
    'files.exclude': {
        '**/.git': true,
        '**/.DS_Store': true,
        '**/Thumbs.db': true,
        '**/.aleph': true
    },
    'deno.enable': true,
    'deno.unstable': true,
    'deno.import_map': './import_map.json',
    'deno.import_intellisense_autodiscovery': true,
    'deno.import_intellisense_origins': {
        'https://deno.land': true,
        'https://esm.sh': true
    }
}

export const helpMessage = `
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

    await ensureDir(path.join(appDir, '.vscode'))
    await Deno.writeTextFile(path.join(appDir, '.vscode', 'extensions.json'), JSON.stringify(vscExtensions, undefined, 4))
    await Deno.writeTextFile(path.join(appDir, '.vscode', 'settings.json'), JSON.stringify(vscSettings, undefined, 4))
    await Deno.writeTextFile(path.join(appDir, '.gitignore'), gitignore.join('\n'))
    await Deno.writeTextFile(path.join(appDir, 'import_map.json'), JSON.stringify({ imports: {} }, undefined, 4))

    log.info('Done')
    log.info('---')
    log.info(colors.dim('Aleph App is ready to Go.'))
    log.info(`${colors.dim('$')} cd ` + path.basename(appDir))
    log.info(`${colors.dim('$')} aleph ${colors.bold('dev')}    ${colors.dim('# start the app in development mode')}`)
    log.info(`${colors.dim('$')} aleph ${colors.bold('start')}  ${colors.dim('# start the app in production mode')}`)
    log.info(`${colors.dim('$')} aleph ${colors.bold('build')}  ${colors.dim('# build the app in production mode')}`)
    log.info('---')
    Deno.exit(0)
}
