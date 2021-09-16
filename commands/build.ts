import { resolve } from 'https://deno.land/std@0.106.0/path/mod.ts'
import { Aleph } from '../server/aleph.ts'
import { parse } from './helper/flags.ts'
import log from '../shared/log.ts'
import { existsDir } from '../shared/fs.ts'

export const helpMessage = `
Usage:
    aleph build <dir> [...options]

<dir> represents the directory of Aleph.js app,
if the <dir> is empty, the current directory will be used.

Options:
    -L, --log-level <log-level>  Set log level [possible values: debug, info]
    -r, --reload                 Reload source code cache
    -h, --help                   Prints help message
`

if (import.meta.main) {
  const { args, options } = parse()

  // check working dir
  const workingDir = resolve(String(args[0] || '.'))
  if (!await existsDir(workingDir)) {
    log.fatal('No such directory:', workingDir)
  }

  const aleph = new Aleph(workingDir, 'production', Boolean(options.r || options.reload))
  await aleph.build()
  Deno.exit(0)
}
