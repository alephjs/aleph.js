import { serve } from 'https://deno.land/std@0.106.0/http/server.ts'
import { Aleph } from '../server/aleph.ts'
import { parse, getFlag, parsePortNumber } from './helper/flags.ts'
import log from '../shared/log.ts'

export const helpMessage = `
Usage:
    aleph analyze <dir> [...options]

<dir> represents the directory of Aleph.js app,
if the <dir> is empty, the current directory will be used.

Options:
    -p, --port      <port>       A port number to serve the analyze result, default is 9000
    -L, --log-level <log-level>  Set log level [possible values: debug, info]
    -r, --reload                 Reload source code cache
    -h, --help                   Prints help message
`

export default async function () {
  const { args, options } = parse()

  // check working dir
  const workingDir = resolve(String(args[0] || '.'))
  if (!await existsDir(workingDir)) {
    log.fatal('No such directory:', workingDir)
  }

  const aleph = new Aleph(workingDir, 'production', Boolean(options.r || options.reload))
  const port = parsePortNumber(getFlag(options, ['p', 'port'], '9000'))
  await aleph.ready
  const entries = aleph.analyze()
  const s = serve({ port })
  log.info(`Server ready on http://localhost:${port}`)
  for await (const r of s) {
    r.respond({
      headers: new Headers({
        // todo: analyze page
        'content-type': 'application/json',
      }),
      body: JSON.stringify(entries)
    })
  }
}
