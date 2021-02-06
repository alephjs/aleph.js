import type { ServeOptions } from '../server/mod.ts'
import { Application, serve } from '../server/mod.ts'
import { getFlag, parsePortNumber } from '../server/util.ts'
import log from '../shared/log.ts'

export const helpMessage = `
Usage:
    aleph start <dir> [...options]

<dir> represents the directory of the aleph.js app,
if the <dir> is empty, the current directory will be used.

Options:
    -p, --port      <port>       A port number to start the aleph.js app, default is 8080
        --hostname  <hostname>   The address at which the server is to be started
        --cert      <certFile>   The server certificate file
        --key       <keyFile>    The server public key file
    -L, --log-level <log-level>  Set log level [possible values: debug, info]
    -r, --reload                 Reload source code cache
    -h, --help                   Prints help message
`

export default async function (workingDir: string, flags: Record<string, string | boolean>) {
  const app = new Application(workingDir, 'production', Boolean(flags.r || flags.reload))
  const port = parsePortNumber(getFlag(flags, ['p', 'port'], '8080'))
  const hostname = getFlag(flags, ['hostname'], 'localhost')
  const certFile = getFlag(flags, ['cert'])
  const keyFile = getFlag(flags, ['key'])
  const opts: ServeOptions = { app, port, hostname }
  if (certFile && keyFile) {
    opts.certFile = certFile
    opts.keyFile = keyFile
  } else if (certFile) {
    log.fatal('missing `--key` option')
  } else if (keyFile) {
    log.fatal('missing `--cert` option')
  }
  await serve(opts)
}
