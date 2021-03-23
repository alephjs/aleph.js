import { Untar } from 'std/archive/tar.ts'
import { green, dim } from 'std/fmt/colors.ts'
import { ensureDir } from 'std/fs/ensure_dir.ts'
import { join } from 'std/path/mod.ts'
import { gzipDecode } from 'gzip'
import { ensureTextFile } from '../shared/fs.ts'
import util from '../shared/util.ts'
import { VERSION } from '../version.ts'

export const helpMessage = `
Usage:
    aleph init <name> [...options]

<name> represents the name of Aleph.js app.

Options:
    -h, --help  Prints help message
`

export default async function (nameArg?: string) {
  const cwd = Deno.cwd()
  const rev = 'master'

  const name = nameArg || (await ask('Name:')).trim()
  if (name === '') {
    return
  }

  const template = 'hello-world' // todo: add template select ui
  const vscode = await confirm('Add recommended workspace settings of VS Code?')

  console.log('Downloading template...')
  const resp = await fetch('https://codeload.github.com/alephjs/alephjs-templates/tar.gz/' + rev)
  const gzData = await Deno.readAll(new Deno.Buffer(await resp.arrayBuffer()))

  console.log('Saving template...')
  const tarData = gzipDecode(gzData)
  const entryList = new Untar(new Deno.Buffer(tarData))

  for await (const entry of entryList) {
    if (entry.fileName.startsWith(`alephjs-templates-${rev}/${template}/`)) {
      const fp = join(cwd, name, util.trimPrefix(entry.fileName, `alephjs-templates-${rev}/${template}/`))
      if (entry.type === 'directory') {
        await ensureDir(fp)
        continue
      }
      await ensureTextFile(fp, '')
      const file = await Deno.open(fp, { write: true })
      await Deno.copy(entry, file)
    }
  }

  const gitignore = [
    '.DS_Store',
    'Thumbs.db',
    '.aleph/',
    'dist/',
  ]
  const importMap = {
    imports: {
      '~/': './', '@/': './',
      'aleph': `https://deno.land/x/aleph@v${VERSION}/mod.ts`,
      'aleph/': `https://deno.land/x/aleph@v${VERSION}/`,
      'react': 'https://esm.sh/react@17.0.1',
      'react-dom': 'https://esm.sh/react-dom@17.0.1',
    },
    scopes: {}
  }
  await Promise.all([
    Deno.writeTextFile(join(cwd, name, '.gitignore'), gitignore.join('\n')),
    Deno.writeTextFile(join(cwd, name, 'import_map.json'), JSON.stringify(importMap, undefined, 4))
  ])

  if (vscode) {
    const extensions = {
      'recommendations': [
        'denoland.vscode-deno'
      ]
    }
    const settigns = {
      'deno.enable': true,
      'deno.unstable': true,
      'deno.importMap': './import_map.json'
    }
    await ensureDir(join(name, '.vscode'))
    await Promise.all([
      Deno.writeTextFile(join(name, '.vscode', 'extensions.json'), JSON.stringify(extensions, undefined, 4)),
      Deno.writeTextFile(join(name, '.vscode', 'settings.json'), JSON.stringify(settigns, undefined, 4))
    ])
  }

  console.log('Done')
  console.log(dim('---'))
  console.log(green('Aleph.js is ready to go!'))
  console.log(`${dim('$')} cd ${name}`)
  console.log(`${dim('$')} aleph dev     ${dim('# start the app in `development` mode')}`)
  console.log(`${dim('$')} aleph start   ${dim('# start the app in `production` mode')}`)
  console.log(`${dim('$')} aleph build   ${dim('# build the app to a static site (SSG)')}`)
  console.log(dim('---'))
  Deno.exit(0)
}

async function ask(question: string = ':', stdin = Deno.stdin, stdout = Deno.stdout) {
  await stdout.write(new TextEncoder().encode(question + ' '))
  const buf = new Uint8Array(1024)
  const n = <number>await stdin.read(buf)
  const answer = new TextDecoder().decode(buf.subarray(0, n))
  return answer.trim()
}

async function confirm(question: string = 'are you sure?') {
  let a: string
  while (!/^(y(es)?|no?)$/i.test(a = (await ask(question + ' [y/n]')).trim())) { }
  return a.charAt(0).toLowerCase() === 'y'
}
