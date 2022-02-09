import { readableStreamFromReader } from "https://deno.land/std@0.125.0/streams/conversion.ts"
import { content } from "./response.ts"
import { getContentType } from "./mime.ts"
import ssr from "./ssr.ts"
import util from "../shared/util.ts"
import log from "../shared/log.ts"
import type { Context, SSREvent } from "../types.d.ts"

export type ServerOptions = {
  routes?: string | string[]
  fetch?: (request: Request, context: Context) => Promise<Response>,
  ssr?: (e: SSREvent) => string
}

export const serve = (options: ServerOptions) => {
  let indexHtml: string | null | undefined = undefined

  return {
    async fetch(req: Request, env: Record<string, string>) {
      const url = new URL(req.url)
      const { pathname } = url

      // request assets
      try {
        const file = await Deno.open(`./public/${pathname}`)
        return new Response(readableStreamFromReader(file), { headers: { "content-type": getContentType(pathname) } })
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) {
          log.error(err)
          return new Response("Internal Server Error", { status: 500 })
        }
      }

      const ctx: Context = { env, data: {} }
      if (util.isFunction(options.fetch)) {
        const resp = options.fetch(req, ctx)
        if (resp instanceof Response) {
          return resp
        }
      }

      if (indexHtml === undefined) {
        try {
          indexHtml = await Deno.readTextFile("./index.html")
          // since HTMLRewriter can't handle `<ssr-body />` correctly replace it to `<ssr-body></ssr-body>`
          indexHtml = indexHtml.replace(/<ssr-(head|body)\s+\/>/g, "<ssr-$1></ssr-$1>")
        } catch (err) {
          if (err instanceof Deno.errors.NotFound) {
            indexHtml = null
          } else {
            log.error(err)
            return new Response("Internal Server Error", { status: 500 })
          }
        }
      }

      if (indexHtml === null) {
        return new Response("Not Found", { status: 404 })
      }

      // request page data
      for (const routePath in dataRoutes) {
        const [params, ok] = matchPath(routePath, pathname)
        if (ok) {
          if (req.method !== "GET" || req.headers.has("X-Fetch-Data") || !(routePath in routes)) {
            const request = new Request(util.appendUrlParams(url, params).toString(), req)
            const fetcher = dataRoutes[routePath][req.method.toLowerCase()]
            if (util.isFunction(fetcher)) {
              const allFetcher = dataRoutes[routePath].all
              if (util.isFunction(allFetcher)) {
                let res = allFetcher(request)
                if (res instanceof Promise) {
                  res = await res
                }
                if (res instanceof Response) {
                  return res
                }
              }
              return fetcher(request, ctx)
            }
            return new Response('Method not allowed', { status: 405 })
          }
        }
      }

      // request ssr
      if (util.isFunction(options.ssr)) {
        return ssr.fetch(req, ctx, { handler: options.ssr, htmlTpl: indexHtml })
      }
      return content(indexHtml, "text/html; charset=utf-8")
    }
  }
}
