import { join } from 'std/path/mod.ts'
import { serve as stdServe, serveTLS } from 'std/http/server.ts'
import { acceptWebSocket, isWebSocketCloseEvent } from 'std/ws/mod.ts'
import { trimModuleExt } from '../framework/core/module.ts'
import { rewriteURL } from '../framework/core/routing.ts'
import { existsFileSync } from '../shared/fs.ts'
import log from '../shared/log.ts'
import util from '../shared/util.ts'
import type { ServerRequest } from '../types.ts'
import { Request } from './api.ts'
import { Application } from './app.ts'
import { getContentType } from './mime.ts'

/** The Aleph server class. */
export class Server {
  #app: Application
  #ready: boolean

  constructor(app: Application) {
    this.#app = app
    this.#ready = false
  }

  async handle(r: ServerRequest) {
    if (!this.#ready) {
      await this.#app.ready
      this.#ready = true
    }

    const app = this.#app
    const { baseUrl, rewrites } = app.config
    const url = rewriteURL(r.url, baseUrl, rewrites)
    const pathname = decodeURI(url.pathname)
    const req = new Request(r, url.searchParams)

    // set custom headers
    for (const key in app.config.headers) {
      req.setHeader(key, app.config.headers[key])
    }
    if (app.isDev) {
      req.setHeader('Cache-Control', 'max-age=0')
    }

    try {
      // serve hmr ws
      if (pathname === '/_hmr') {
        const { conn, r: bufReader, w: bufWriter, headers } = r
        const socket = await acceptWebSocket({ conn, bufReader, bufWriter, headers })
        const watcher = app.createFSWatcher()
        watcher.on('add', (mod: any) => socket.send(JSON.stringify({ ...mod, type: 'add' })))
        watcher.on('remove', (url: string) => {
          watcher.removeAllListeners('modify-' + url)
          socket.send(JSON.stringify({ type: 'remove', url }))
        })
        for await (const e of socket) {
          if (util.isNEString(e)) {
            try {
              const data = JSON.parse(e)
              if (data.type === 'hotAccept' && util.isNEString(data.url)) {
                const mod = app.getModule(data.url)
                if (mod) {
                  watcher.on('modify-' + mod.url, (hash: string) => {
                    socket.send(JSON.stringify({
                      type: 'update',
                      url: mod.url,
                      updateUrl: util.cleanPath(`${baseUrl}/_aleph/${trimModuleExt(mod.url)}.js`),
                      hash,
                    }))
                  })
                }
              }
            } catch (e) { }
          } else if (isWebSocketCloseEvent(e)) {
            break
          }
        }
        app.removeFSWatcher(watcher)
        return
      }

      // serve dist files
      if (pathname.startsWith('/_aleph/')) {
        if (pathname.startsWith('/_aleph/data/') && pathname.endsWith('.json')) {
          let p = util.trimSuffix(util.trimPrefix(pathname, '/_aleph/data'), '.json')
          if (p === '/index') {
            p = '/'
          }
          const data = await app.getSSRData({ pathname: p })
          if (data === null) {
            req.status(404).send('null', 'application/json; charset=utf-8')
          } else {
            req.send(JSON.stringify(data), 'application/json; charset=utf-8')
          }
          return
        }

        if (pathname == '/_aleph/main.js') {
          req.send(app.getMainJS(false), 'application/javascript; charset=utf-8')
          return
        }

        const filePath = join(app.buildDir, util.trimPrefix(pathname, '/_aleph/'))
        if (existsFileSync(filePath)) {
          const info = Deno.lstatSync(filePath)
          const lastModified = info.mtime?.toUTCString() ?? (new Date).toUTCString()
          if (lastModified === r.headers.get('If-Modified-Since')) {
            req.status(304).send('')
            return
          }

          let content = await Deno.readTextFile(filePath)
          if (app.isDev && filePath.endsWith('.js')) {
            const metaFile = util.trimSuffix(filePath, '.js') + '.meta.json'
            if (existsFileSync(metaFile)) {
              try {
                const { url } = JSON.parse(await Deno.readTextFile(metaFile))
                const mod = app.getModule(url)
                if (mod && app.isHMRable(mod.url)) {
                  content = app.injectHMRCode(mod, content)
                }
              } catch (e) { }
            }
          }

          req.setHeader('Last-Modified', lastModified)
          req.send(content, getContentType(filePath))
          return
        }

        req.status(404).send('not found')
        return
      }

      // serve public files
      const filePath = join(app.workingDir, 'public', pathname)
      if (existsFileSync(filePath)) {
        const info = Deno.lstatSync(filePath)
        const lastModified = info.mtime?.toUTCString() ?? (new Date).toUTCString()
        if (lastModified === r.headers.get('If-Modified-Since')) {
          req.status(304).send('')
          return
        }

        const body = Deno.readFileSync(filePath)
        req.setHeader('Last-Modified', lastModified)
        req.send(body, getContentType(filePath))
        return
      }

      // serve APIs
      if (pathname.startsWith('/api/')) {
        const route = app.getAPIRoute({
          pathname,
          search: Array.from(url.searchParams.keys()).length > 0 ? '?' + url.searchParams.toString() : ''
        })
        if (route !== null) {
          try {
            const [{ params }, { jsFile, hash }] = route
            const { default: handle } = await import(`file://${jsFile}#${hash.slice(0, 6)}`)
            if (util.isFunction(handle)) {
              await handle(new Request(req, params))
            } else {
              req.status(500).json({ status: 500, message: 'bad api handler' })
            }
          } catch (err) {
            req.status(500).json({ status: 500, message: err.message })
            log.error('invoke API:', err)
          }
        } else {
          req.status(404).json({ status: 404, message: 'not found' })
        }
        return
      }

      // ssr
      const [status, html] = await app.getPageHTML({
        pathname,
        search: Array.from(url.searchParams.keys()).length > 0 ? '?' + url.searchParams.toString() : ''
      })
      req.status(status).send(html, 'text/html; charset=utf-8')
    } catch (err) {
      req.status(500).send(
        `<!DOCTYPE html><title>500 - internal server error</title><p><strong><code>500</code></strong><small> - </small><span>${err.message}</span></p>`,
        'text/html; charset=utf-8'
      )
    }
  }
}

/** Options for creating a standard Aleph server. */
export type ServeOptions = {
  /** The Aleph Server Application to serve. */
  app: Application
  /** The port to listen on. */
  port: number
  /** A literal IP address or host name that can be resolved to an IP address.
   * If not specified, defaults to `0.0.0.0`. */
  hostname?: string
  /** Server certificate file. */
  certFile?: string
  /** Server public key file. */
  keyFile?: string
}

/** Create a standard Aleph server. */
export async function serve({ app, port, hostname, certFile, keyFile }: ServeOptions) {
  const server = new Server(app)
  await app.ready

  while (true) {
    try {
      let s: AsyncIterable<ServerRequest>
      if (certFile && keyFile) {
        s = serveTLS({ port, hostname, certFile, keyFile })
      } else {
        s = stdServe({ port, hostname })
      }
      log.info(`Server ready on http://${hostname || 'localhost'}:${port}${app.config.baseUrl}`)
      for await (const r of s) {
        server.handle(r)
      }
    } catch (err) {
      if (err instanceof Deno.errors.AddrInUse && app.isDev) {
        log.warn(`port ${port} already in use, try ${port + 1}...`)
        port++
      } else {
        log.fatal(err.message)
      }
    }
  }
}
