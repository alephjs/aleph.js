import { resolve } from 'https://deno.land/std@0.106.0/path/mod.ts'
import { Aleph } from '../server/aleph.ts'
import { serve } from '../server/mod.ts'
import { getFlag, parse, parsePortNumber } from './helper/flags.ts'
import log from '../shared/log.ts'
import { existsDir } from '../shared/fs.ts'

export const helpMessage = `
Usage:
    aleph dev <dir> [...options]

<dir> represents the directory of Aleph.js app,
if the <dir> is empty, the current directory will be used.

Options:
    -p, --port      <port>       A port number to start the Aleph.js app, default is 8080
        --hostname  <hostname>   The address at which the server is to be started
        --tls-cert  <cert-file>  The server certificate file
        --tls-key   <key-file>   The server public key file
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

  const aleph = new Aleph(workingDir, 'development', Boolean(options.r || options.reload))
  const port = parsePortNumber(getFlag(options, ['p', 'port'], '8080'))
  const hostname = getFlag(options, ['hostname'])
  const certFile = getFlag(options, ['tls-cert'])
  const keyFile = getFlag(options, ['tls-key'])
  if (keyFile !== undefined && certFile === undefined) {
    log.fatal('missing `--tls-cert` option')
  } else if (certFile !== undefined && keyFile === undefined) {
    log.fatal('missing `--tls-key` option')
  }
  await serve({ aleph, port, hostname, certFile, keyFile })
}
