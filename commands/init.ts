import { Untar } from 'https://deno.land/std@0.106.0/archive/tar.ts'
import { Buffer } from 'https://deno.land/std@0.106.0/io/buffer.ts'
import { readAll } from 'https://deno.land/std@0.106.0/io/util.ts'
import { green, blue, dim, red, cyan } from 'https://deno.land/std@0.106.0/fmt/colors.ts'
import { ensureDir } from 'https://deno.land/std@0.106.0/fs/ensure_dir.ts'
import { join } from 'https://deno.land/std@0.106.0/path/mod.ts'
import { gunzip } from 'https://deno.land/x/denoflate@1.2.1/mod.ts'
import { ensureTextFile, existsDir } from '../shared/fs.ts'
import util from '../shared/util.ts'
import { defaultReactVersion } from '../shared/constants.ts'
import { VERSION } from '../version.ts'
import { deno_x_brotli, deno_x_flate } from '../server/compress.ts'

export const helpMessage = `
Usage:
    aleph init <name> [...options]

<name> represents the name of new app.

Options:
    -t, --template <path-to-template> Specify a template for the created project
    -h, --help                        Prints help message
`

export default async function (
  template: string = 'hello-world',
  nameArg?: string,
) {
  const cwd = Deno.cwd()
  const rev = 'master'

  const name = nameArg || (await ask('Name:')).trim()
  if (name === '') {
    return
  }

  if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name)) {
    console.error(`Invalid project name: ${red(name)}`)
    return
  }

  const hasTemplate = await util.isUrlOk('https://api.github.com/repos/alephjs/alephjs-templates/contents/' + template)

  if (!hasTemplate) {
    console.error(
      `Could not use a template named ${red(template)}. Please check your spelling and try again.`,
    )
    Deno.exit(1)
  }

  // check dir is clean
  if (!await isFolderEmpty(cwd, name)) {
    if (!await confirm('Continue?')) {
      Deno.exit(1)
    }
  }

  // ask to create vscode files
  const vscode = await confirm('Using VS Code?')
  const vercel = await confirm('Deploy to Vercel?')

  // download template
  console.log('Downloading template. This might take a moment...')
  const resp = await fetch(
    'https://codeload.github.com/alephjs/alephjs-templates/tar.gz/' + rev,
  )
  const gzData = await readAll(new Buffer(await resp.arrayBuffer()))

  console.log('Apply template...')
  const tarData = gunzip(gzData)
  const entryList = new Untar(new Buffer(tarData))

  for await (const entry of entryList) {
    if (entry.fileName.startsWith(`alephjs-templates-${rev}/${template}/`)) {
      const fp = join(
        cwd,
        name,
        util.trimPrefix(
          entry.fileName,
          `alephjs-templates-${rev}/${template}/`,
        ),
      )
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
      '~/': './',
      'aleph/': `https://deno.land/x/aleph@v${VERSION}/`,
      'aleph/types': `https://deno.land/x/aleph@v${VERSION}/types.d.ts`,
      'aleph/web': `https://deno.land/x/aleph@v${VERSION}/framework/core/mod.ts`,
      'aleph/react': `https://deno.land/x/aleph@v${VERSION}/framework/react/mod.ts`,
      'react': `https://esm.sh/react@${defaultReactVersion}`,
      'react-dom': `https://esm.sh/react-dom@${defaultReactVersion}`,
    },
    scopes: {},
  }
  await Promise.all([
    Deno.writeTextFile(join(cwd, name, '.gitignore'), gitignore.join('\n')),
    Deno.writeTextFile(
      join(cwd, name, 'import_map.json'),
      JSON.stringify(importMap, undefined, 2),
    ),
  ])

  if (vscode) {
    const extensions = {
      'recommendations': [
        'denoland.vscode-deno',
      ],
    }
    const settigns = {
      'deno.enable': true,
      'deno.unstable': true,
      'deno.importMap': './import_map.json',
    }
    await ensureDir(join(name, '.vscode'))
    await Promise.all([
      Deno.writeTextFile(
        join(name, '.vscode', 'extensions.json'),
        JSON.stringify(extensions, undefined, 2),
      ),
      Deno.writeTextFile(
        join(name, '.vscode', 'settings.json'),
        JSON.stringify(settigns, undefined, 2),
      ),
    ])
  }

  if (vercel) {
    Deno.writeTextFile(
      join(name, 'vercel.json'),
      JSON.stringify({
        functions: {
          'api/**/*.{j,t}s': {
            runtime: 'vercel-aleph@0.6.0'
          }
        }
      }, undefined, 2),
    )
  }

  // cache deps in import maps
  console.log('Cache deps...')
  const urls = Object.values(importMap.imports).filter((v) => !v.endsWith('/'))
  const p = Deno.run({
    cmd: [Deno.execPath(), 'cache', ...urls, deno_x_brotli, deno_x_flate],
    stderr: 'inherit',
    stdout: 'inherit',
  })
  await p.status()
  p.close()

  console.log('Done')
  console.log(`
${green('Aleph.js is ready to go!')}
${dim('▲')} cd ${name}
${dim('▲')} aleph dev    ${dim('# start the app in `development` mode')}
${dim('▲')} aleph start  ${dim('# start the app in `production` mode')}
${dim('▲')} aleph build  ${dim('# build the app to a static site (SSG)')}

Docs: ${cyan('https://alephjs.org/docs')}
Bugs: ${cyan('https://alephjs.org.com/alephjs/aleph.js/issues')}
`
  )

  Deno.exit(0)
}

async function ask(
  question: string = ':',
  stdin = Deno.stdin,
  stdout = Deno.stdout,
) {
  await stdout.write(new TextEncoder().encode(question + ' '))
  const buf = new Uint8Array(1024)
  const n = <number>await stdin.read(buf)
  const answer = new TextDecoder().decode(buf.subarray(0, n))
  return answer.trim()
}

async function confirm(question: string = 'are you sure?') {
  let a: string
  while (!/^(y(es)?|no?)$/i.test(a = (await ask(question + ' ' + dim('[y/n]'))).trim())) { }
  return a.charAt(0).toLowerCase() === 'y'
}

async function isFolderEmpty(root: string, name: string): Promise<boolean> {
  const validFiles = [
    '.DS_Store',
    '.git',
    '.gitattributes',
    '.gitignore',
    '.gitlab-ci.yml',
    '.hg',
    '.hgcheck',
    '.hgignore',
    '.idea',
    '.travis.yml',
    'LICENSE',
    'Thumbs.db',
    'docs',
    'public',
    'api',
    'pages',
    'src',
    'app.tsx',
    'aleph.config.ts',
    'import_map.json',
    'mkdocs.yml',
  ]

  const conflicts = []

  if (await existsDir(join(root, name))) {
    for await (const { name: file, isDirectory } of Deno.readDir(join(root, name))) {
      // Support IntelliJ IDEA-based editors
      if (validFiles.includes(file) || /\.iml$/.test(file)) {
        if (isDirectory) {
          conflicts.push(blue(file) + '/')
        } else {
          conflicts.push(file)
        }
      }
    }
  }

  if (conflicts.length > 0) {
    console.log(
      [
        `The directory ${green(name)} contains files that could conflict:`,
        '',
        ...conflicts.filter(name => name.endsWith('/')).sort().map(name => dim('- ') + name),
        ...conflicts.filter(name => !name.endsWith('/')).sort().map(name => dim('- ') + name),
        ''
      ].join('\n')
    )
    return false
  }

  return true
}
