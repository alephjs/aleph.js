import util from "../shared/util.ts"

async function fetchData(req: Request, ctx: any): Promise<void | Response | { data: object, cacheTtl?: number }> {
  const url = new URL(req.url)
  const pathname = util.cleanPath(url.pathname)
  const dataRoutes: [URLPattern, Record<string, any>][] = (self as any).__ALEPH_DATA_ROUTES
  if (util.isArray(dataRoutes)) {
    for (const [pattern, config] of dataRoutes) {
      const ret = pattern.exec({ pathname })
      if (ret) {
        const request = new Request(util.appendUrlParams(url, ret.pathname.groups).toString(), req)
        const fetcher = config.get
        if (util.isFunction(fetcher)) {
          const allFetcher = config.all
          if (util.isFunction(allFetcher)) {
            let res = allFetcher(request)
            if (res instanceof Promise) {
              res = await res
            }
            if (res instanceof Response) {
              return res
            }
          }
          let res = fetcher(request, ctx)
          if (res instanceof Promise) {
            res = await res
          }
          if (res instanceof Response) {
            if (res.status !== 200) {
              return res
            }
            return {
              data: await res.json(),
              cacheTtl: config.cacheTtl,
            }
          }
        }
      }
    }
  }
}

export default {
  async fetch(req: Request, ctx: Context, ssr: { handler: (e: any) => string, htmlTpl: string, css?: string }): Promise<Response> {
    // get data
    const dataRes = await fetchData(req, ctx)
    if (dataRes instanceof Response) {
      return dataRes
    }
    // ssr
    const headCollection: string[] = []
    const ssrBody = ssr.handler({ data: dataRes?.data, url: new URL(req.url), headCollection })
    const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" })
    if (util.isNumber(dataRes?.cacheTtl)) {
      headers.append("Cache-Control", `public, max-age=${dataRes?.cacheTtl}`)
    } else {
      headers.append("Cache-Control", "public, max-age=0, must-revalidate")
    }
    const htmlRes = new Response(ssr.htmlTpl, { headers })
    return htmlRes
    // return new HTMLRewriter().on("ssr-head", {
    //   element(el) {
    //     if (ssr.css) {
    //       el.before(`<style>${ssr.css}</style>`, { html: true })
    //     }
    //     if (dataRes?.data) {
    //       el.before(`<script id="ssr-data" type="application/json">${JSON.stringify(dataRes?.data)}</script>`, { html: true })
    //     }
    //     headCollection.forEach(tag => el.before(tag, { html: true }))
    //     el.remove()
    //   }
    // }).on("ssr-body", {
    //   element(el) {
    //     el.replace(ssrBody, { html: true })
    //   }
    // }).on("script", {
    //   element(el) {
    //     const type = el.getAttribute("type")
    //     if (!type || type === "module") {
    //       if (type) {
    //         el.removeAttribute("type")
    //       }
    //       el.setAttribute("src", `/main.tsx?v=${ctx.env.VERSION}`)
    //     }
    //   }
    // }).transform(htmlRes)
  }
}
