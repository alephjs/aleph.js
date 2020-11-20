import { Confirm, Input } from 'https://deno.land/x/cliffy/prompt/mod.ts'
import { gzipDecode } from 'https://deno.land/x/wasm_gzip@v1.0.0/mod.ts'
import { ensureTextFile } from '../fs.ts'
import log from '../log.ts'
import { colors, ensureDir, fromStreamReader, path, Untar } from '../std.ts'
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
    'deno.import_map': './import_map.json'
}

export const helpMessage = `
Usage:
    aleph init <dir> [...options]

<dir> represents the directory of Aleph.js app,
if the <dir> is empty, the current directory will be used.

Options:
    -h, --help  Prints help message
`

export default async function (appDir: string, options: Record<string, string | boolean>) {
    const rev = 'master'
    const templateRepo = await Input.prompt({ message: 'What Aleph.js Github Template Repository Do You Want To Use (Press Enter To Use Default)?', default: 'aleph.js/alephjs-templates' })
    log.info('Downloading template...')
    const resp = await fetch(`https://codeload.github.com/${templateRepo}/tar.gz/${rev}`)
    const gzData = await Deno.readAll(fromStreamReader(resp.body!.getReader()))
    log.info('Saving template...')
    const tarData = gzipDecode(gzData)
    const entryList = new Untar(new Deno.Buffer(tarData))

    const template = await Input.prompt({ message: 'What Aleph.js Template Do You Want To Use (Press Enter To Use Default)?', default: 'hello-world' })
    for await (const entry of entryList) {
        if (entry.fileName.startsWith(`${templateRepo.match(/([^/]+$)/i)}-${rev}/${template}/`)) {
            const fp = path.join(appDir, util.trimPrefix(entry.fileName, `${templateRepo.match(/([^/]+$)/i)}-${rev}/${template}/`))
            if (entry.type === 'directory') {
                await ensureDir(fp)
                continue
            }
            await ensureTextFile(fp, '')
            const file = await Deno.open(fp, { write: true })
            await Deno.copy(entry, file)
        }
    }

    if (await Confirm.prompt('Are you using Visual Studio Code?')) {
        await ensureDir(path.join(appDir, '.vscode'))
        await Deno.writeTextFile(path.join(appDir, '.vscode', 'extensions.json'), JSON.stringify(vscExtensions, undefined, 4))
        await Deno.writeTextFile(path.join(appDir, '.vscode', 'settings.json'), JSON.stringify(vscSettings, undefined, 4))
    }
    await Deno.writeTextFile(path.join(appDir, '.gitignore'), gitignore.join('\n'))
    await Deno.writeTextFile(path.join(appDir, 'import_map.json'), JSON.stringify({ imports: {} }, undefined, 4))

    log.info('Done')
    log.info('---')
    log.info(colors.dim('Aleph.js is ready to Go.'))
    log.info(`${colors.dim('$')} cd ` + path.basename(appDir))
    log.info(`${colors.dim('$')} aleph ${colors.bold('dev')}    ${colors.dim('# start the app in `development` mode')}`)
    log.info(`${colors.dim('$')} aleph ${colors.bold('start')}  ${colors.dim('# start the app in `production` mode')}`)
    log.info(`${colors.dim('$')} aleph ${colors.bold('build')}  ${colors.dim('# build the app to a static site (SSG)')}`)
    log.info('---')
    Deno.exit(0)
}
