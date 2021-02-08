import { path, serve as stdServe, serveTLS, ws } from '../deps.ts'
import { rewriteURL, RouteModule } from '../framework/core/routing.ts'
import { existsFileSync } from '../shared/fs.ts'
import log from '../shared/log.ts'
import util from '../shared/util.ts'
import type { ServerRequest } from '../types.ts'
import { Request } from './api.ts'
import { Application } from './app.ts'
import { createHtml, reHashJs } from './helper.ts'
import { getContentType } from './mime.ts'

/** The Aleph Server class. */
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
    const req = new Request(r, {}, url.searchParams)

    // set custom headers
    for (const key in app.config.headers) {
      req.setHeader(key, app.config.headers[key])
    }

    try {
      // serve hmr ws
      if (pathname === '/_hmr') {
        const { conn, r: bufReader, w: bufWriter, headers } = r
        ws.acceptWebSocket({ conn, bufReader, bufWriter, headers }).then(async socket => {
          const watcher = app.createFSWatcher()
          watcher.on('add', (mod: RouteModule) => socket.send(JSON.stringify({ ...mod, type: 'add' })))
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
                        updateUrl: util.cleanPath(`${baseUrl}/_aleph/${util.trimModuleExt(mod.url)}.${util.shortHash(hash)}.js`),
                        hash,
                      }))
                    })
                  }
                }
              } catch (e) { }
            } else if (ws.isWebSocketCloseEvent(e)) {
              break
            }
          }
          app.removeFSWatcher(watcher)
        })
        return
      }

      // serve dist files
      if (pathname.startsWith('/_aleph/')) {
        if (pathname.startsWith('/_aleph/data/') && pathname.endsWith('.json')) {
          let p = util.trimSuffix(util.trimPrefix(pathname, '/_aleph/data'), '.json')
          if (p === '/index') {
            p = '/'
          }
          const [status, data] = await app.getSSRData({ pathname: p })
          if (status === 200) {
            req.send(JSON.stringify(data), 'application/json; charset=utf-8')
          } else {
            req.status(status).send('')
          }
          return
        } else if (reHashJs.test(pathname) && ['main', 'main.bundle'].includes(util.trimPrefix(pathname, '/_aleph/').replace(reHashJs, ''))) {
          req.send(app.getMainJS(pathname.startsWith('/_aleph/main.bundle')), 'application/javascript; charset=utf-8')
          return
        } else {
          const filePath = path.join(app.buildDir, util.trimPrefix(pathname, '/_aleph/'))
          if (existsFileSync(filePath)) {
            const info = Deno.lstatSync(filePath)
            const lastModified = info.mtime?.toUTCString() ?? new Date().toUTCString()
            if (lastModified === r.headers.get('If-Modified-Since')) {
              req.status(304).send('')
              return
            }

            let content = await Deno.readTextFile(filePath)

            if (reHashJs.test(filePath)) {
              const metaFile = filePath.replace(reHashJs, '') + '.meta.json'
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
        }

        req.status(404).send('file not found')
        return
      }

      // serve public files
      const filePath = path.join(app.workingDir, 'public', pathname)
      if (existsFileSync(filePath)) {
        const info = Deno.lstatSync(filePath)
        const lastModified = info.mtime?.toUTCString() ?? new Date().toUTCString()
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
        app.handleAPIRequest(r, { pathname, search: url.searchParams.toString() })
        return
      }

      // ssr
      const [status, html] = await app.getPageHtml({ pathname, search: url.searchParams.toString() })
      req.status(status).send(html, 'text/html; charset=utf-8')
    } catch (err) {
      req.status(500).send(createHtml({
        lang: 'en',
        head: ['<title>500 - internal server error</title>'],
        body: `<p><strong><code>500</code></strong><small> - </small><span>${err.message}</span></p>`
      }), 'text/html; charset=utf-8')
    }
  }
}

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

/** start a standard aleph server. */
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
      log.info(`Aleph server ready on http://${hostname}:${port}${app.config.baseUrl}`)
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
