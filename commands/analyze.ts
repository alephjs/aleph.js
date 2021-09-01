import { Aleph } from '../server/aleph.ts'
import { getFlag, parsePortNumber } from '../shared/flags.ts'
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

export default async function (workingDir: string, flags: Record<string, any>) {
  const aleph = new Aleph(workingDir, { reload: Boolean(flags.r || flags.reload) })
  const port = parsePortNumber(getFlag(flags, ['p', 'port'], '9000'))
  const server = Deno.listen({ port })

  await aleph.ready
  log.info(`Server ready on http://localhost:${port}`)

  const entries = aleph.analyze()
  for await (const conn of server) {
    (async () => {
      const httpConn = Deno.serveHttp(conn)
      for await (const e of httpConn) {
        // todo: analyze UI
        e.respondWith(new Response(JSON.stringify(entries), {
          headers: new Headers({
            'content-type': 'application/json',
          })
        }))
      }
    })()
  }
}
