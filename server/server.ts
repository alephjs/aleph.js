import { createHash } from 'https://deno.land/std@0.99.0/hash/mod.ts'
import { join } from 'https://deno.land/std@0.99.0/path/mod.ts'
import { SourceType, stripSsrCode } from '../compiler/mod.ts'
import { builtinModuleExts, trimBuiltinModuleExts } from '../framework/core/module.ts'
import { resolveURL } from '../framework/core/routing.ts'
import { existsFile } from '../shared/fs.ts'
import log from '../shared/log.ts'
import util from '../shared/util.ts'
import { VERSION } from '../version.ts'
import { Aleph } from './aleph.ts'
import compress from './compress.ts'
import { getContentType } from './mime.ts'
import { AResponse } from './response.ts'

/** The Aleph server class. */
export class Server {
  #aleph: Aleph
  #ready: boolean

  constructor(app: Aleph) {
    this.#aleph = app
    this.#ready = false
  }

  async handle(req: Request, respond: (r: Response | Promise<Response>) => Promise<void>) {
    if (!this.#ready) {
      await this.#aleph.ready
      this.#ready = true
    }

    const app = this.#aleph
    const { basePath, server: { headers, rewrites } } = app.config
    const url = resolveURL(req.url, basePath, rewrites)
    const pathname = decodeURI(url.pathname)
    const resp = new AResponse(req, respond)

    // set custom headers
    if (headers) {
      for (const key in headers) {
        resp.setHeader(key, headers[key])
      }
    }

    // in dev mode, we use `Last-Modified` and `ETag` header to control cache
    if (app.isDev) {
      resp.setHeader('Cache-Control', 'max-age=0')
    }

    try {
      // serve hmr ws
      if (pathname === '/_hmr') {
        const { websocket } = Deno.upgradeWebSocket(req)
        const watcher = app.createFSWatcher()
        websocket.addEventListener('open', () => {
          watcher.on('add', (mod: any) => websocket.send(JSON.stringify({ ...mod, type: 'add' })))
          watcher.on('remove', (specifier: string) => {
            watcher.removeAllListeners('modify-' + specifier)
            websocket.send(JSON.stringify({ type: 'remove', specifier }))
          })
          log.debug('hmr connected')
        })
        websocket.addEventListener('close', () => {
          app.removeFSWatcher(watcher)
          log.debug('hmr closed')
        })
        websocket.addEventListener('message', (e) => {
          if (util.isFilledString(e.data)) {
            try {
              const data = JSON.parse(e.data)
              if (data.type === 'hotAccept' && util.isFilledString(data.specifier)) {
                const mod = app.getModule(data.specifier)
                if (mod) {
                  watcher.on(`modify-${mod.specifier}`, (data) => {
                    websocket.send(JSON.stringify({
                      ...data,
                      type: 'update',
                      specifier: mod.specifier,
                      updateUrl: util.cleanPath(`${basePath}/_aleph/${trimBuiltinModuleExts(mod.specifier)}.js`),
                    }))
                  })
                }
              }
            } catch (e) { }
          }
        })
        return
      }

      // serve dist files
      if (pathname.startsWith('/_aleph/')) {
        if (pathname.startsWith('/_aleph/data/') && pathname.endsWith('.json')) {
          const path = util.atobUrl(util.trimSuffix(util.trimPrefix(pathname, '/_aleph/data/'), '.json'))
          const data = await app.getSSRData({ pathname: path })
          if (data === null) {
            resp.status(404).send('null', 'application/json; charset=utf-8')
          } else {
            resp.send(JSON.stringify(data), 'application/json; charset=utf-8')
          }
          return
        }

        const relPath = util.trimPrefix(pathname, '/_aleph')
        if (relPath == '/main.js') {
          resp.send(app.createMainJS(false), 'application/javascript; charset=utf-8')
          return
        }

        if (relPath.endsWith('.js')) {
          let module = app.findModule(({ jsFile }) => jsFile === relPath)
          if (!module && app.isDev) {
            for (const ext of [...builtinModuleExts.map(ext => `.${ext}`), '']) {
              const sepcifier = util.trimSuffix(relPath, '.js') + ext
              if (await existsFile(join(app.workingDir, sepcifier))) {
                module = await app.compile(sepcifier)
                break
              }
            }
          }
          if (module) {
            const { specifier } = module
            const content = await app.getModuleJS(module)
            if (content) {
              const etag = createHash('md5').update(VERSION).update(module.hash || module.sourceHash).toString()
              if (etag === req.headers.get('If-None-Match')) {
                resp.status(304).send()
                return
              }

              resp.setHeader('ETag', etag)
              if (app.isDev && app.isHMRable(specifier)) {
                let code = new TextDecoder().decode(content)
                if (module.denoHooks?.length || module.ssrPropsFn || module.ssgPathsFn) {
                  if ('csrCode' in module) {
                    code = (module as any).csrCode
                  } else {
                    const { code: csrCode } = await stripSsrCode(specifier, code, { sourceMap: true, swcOptions: { sourceType: SourceType.JS } })
                    Object.assign(module, { csrCode })
                    // todo: merge source map
                    code = csrCode
                  }
                }
                app.getCodeInjects('hmr', specifier)?.forEach(transform => {
                  const ret = transform(specifier, code)
                  code = ret.code
                })
                code = [
                  `import.meta.hot = $createHotContext(${JSON.stringify(specifier)});`,
                  '',
                  code,
                  '',
                  'import.meta.hot.accept();'
                ].join('\n')
                resp.send(code, 'application/javascript; charset=utf-8')
              } else {
                resp.send(content, 'application/javascript; charset=utf-8')
              }
              return
            }
          }
        }

        const filePath = join(app.buildDir, relPath)
        if (await existsFile(filePath)) {
          const info = Deno.lstatSync(filePath)
          const lastModified = info.mtime?.toUTCString() ?? (new Date).toUTCString()
          if (lastModified === req.headers.get('If-Modified-Since')) {
            resp.status(304).send()
            return
          }

          resp.setHeader('Last-Modified', lastModified)
          resp.send(
            await Deno.readTextFile(filePath),
            getContentType(filePath)
          )
          return
        }

        resp.status(404).send('not found')
        return
      }

      // serve public files
      const filePath = join(app.workingDir, 'public', pathname)
      if (await existsFile(filePath)) {
        const info = Deno.lstatSync(filePath)
        const lastModified = info.mtime?.toUTCString() ?? (new Date).toUTCString()
        if (lastModified === req.headers.get('If-Modified-Since')) {
          resp.status(304).send()
          return
        }

        const body = Deno.readFileSync(filePath)
        resp.setHeader('Last-Modified', lastModified)
        resp.send(body, getContentType(filePath))
        return
      }

      // serve APIs
      if (pathname.startsWith('/api/')) {
        const route = await app.getAPIRoute({
          pathname,
          search: Array.from(url.searchParams.keys()).length > 0 ? '?' + url.searchParams.toString() : ''
        })
        if (route !== null) {
          try {
            const [router, module] = route

            const { default: handle } = await app.importModule(module)
            if (util.isFunction(handle)) {
              await handle({ req, resp, router, data: {} })
            } else {
              resp.status(500).json({ status: 500, message: 'bad api handler' })
            }
          } catch (err) {
            resp.status(500).json({ status: 500, message: err.message })
            log.error('invoke API:', err)
          }
        } else {
          resp.status(404).json({ status: 404, message: 'not found' })
        }
        return
      }

      // ssr
      const [status, html] = await app.getPageHTML({
        pathname,
        search: Array.from(url.searchParams.keys()).length > 0 ? '?' + url.searchParams.toString() : ''
      })
      resp.status(status).send(html, 'text/html; charset=utf-8')
    } catch (err) {
      resp.status(500).send(
        [
          `<!DOCTYPE html>`,
          `<title>Server Error</title>`,
          `<h1>Error: ${err.message}</h1>`,
          `<p><pre>${err.stack}</pre></p>`
        ].join('\n'),
        'text/html; charset=utf-8'
      )
    }
  }
}

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
      let l: Deno.Listener
      if (certFile && keyFile)
        l = Deno.listenTls({ port, hostname, certFile, keyFile })
      else {
        l = Deno.listen({ port, hostname })
      }
      if (!aleph.isDev && aleph.config.server.compress) {
        compress.init()
      }
      signal?.addEventListener('abort', () => {
        l.close()
      })
      log.info(`Server ready on http://${hostname || 'localhost'}:${port}${aleph.config.basePath}`)

      for await (const conn of l) {
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
