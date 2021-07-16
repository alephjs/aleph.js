import log from '../shared/log.ts'
import { Aleph } from './aleph.ts'
import compress from './compress.ts'
import { Server } from './server.ts'

/** Options for creating a standard Aleph server. */
export type ServeOptions = {
  /** The Aleph to serve. */
  aleph: Aleph
  /** The port to listen on. */
  port: number
  /**
    * A literal IP address or host name that can be resolved to an IP address.
    * If not specified, defaults to `0.0.0.0`.
    */
  hostname?: string
  /** The certificate file for TLS connection. */
  certFile?: string
  /** The public key file for TLS connection. */
  keyFile?: string
  /* The signal to close the server. */
  signal?: AbortSignal
}

/** Create a standard Aleph server. */
export async function serve({ aleph, port, hostname, certFile, keyFile, signal }: ServeOptions) {
  const server = new Server(aleph)
  await aleph.ready

  while (true) {
    try {
      const s = certFile && keyFile ? Deno.listenTls({ port, hostname, certFile, keyFile }) : Deno.listen({ port, hostname })
      if (!aleph.isDev && aleph.config.server.compress) {
        compress.init()
      }
      signal?.addEventListener('abort', () => {
        s.close()
      })
      log.info(`Server ready on http://${hostname || 'localhost'}:${port}${aleph.config.basePath}`)

      for await (const conn of s) {
        // In order to not be blocking, we need to handle each connection individually
        // in its own async function.
        (async () => {
          const httpConn = Deno.serveHttp(conn)
          // Each request sent over the HTTP connection will be yielded as an async
          // iterator from the HTTP connection.
          for await (const { request, respondWith } of httpConn) {
            server.handle(request, respondWith)
          }
        })()
      }
    } catch (err) {
      if (err instanceof Deno.errors.AddrInUse) {
        if (!aleph.isDev) {
          log.fatal(`port ${port} already in use!`)
        }
        log.warn(`port ${port} already in use, try ${port + 1}...`)
        port++
      } else {
        log.fatal(err.message)
      }
    }
  }
}
