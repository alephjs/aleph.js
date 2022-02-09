import type { FC } from "react"
import { createElement, useEffect, useMemo, useState, useContext } from "react"
import MainContext from "./context.ts"
import util from "../../shared/util.ts"
import type { SSREvent } from "../../types.d.ts"

export type RouterProps = {
  ssr?: SSREvent
}

export const Router: FC<RouterProps> = ({ ssr }) => {
  const [url, setUrl] = useState<URL>(() => ssr?.url || new URL(self.location?.href || "http://localhost/"))
  const page = useMemo<{ Component: FC<any>, params: Record<string, string> }>(() => {
    const pathname = util.cleanPath(url.pathname)
    const dataRoutes: [URLPattern, FC<any>][] = (self as any).ESMD_DATA_ROUTES
    for (const [pattern, fc] of dataRoutes) {
      const p = pattern.exec({ pathname })
      if (p) {
        return { Component: fc, params: p.pathname.groups }
      }
    }
    return { Component: E404, params: {} }
  }, [url])
  const pageUrl = useMemo(() => {
    return Object.keys(page.params).length > 0 ? util.appendUrlParams(url, page.params) : url
  }, [url, page])
  const dataCache = useMemo<any>(() => {
    const cache = new Map()
    const [data, expires] = ssr ? [ssr.data, ssr.dataExpires] : loadSSRDataFromTag()
    cache.set(pageUrl.pathname + pageUrl.search, { data, expires })
    return cache
  }, [])

  useEffect(() => {
    // remove ssr head elements
    const { head } = self.document
    Array.from(head.children).forEach((el: any) => {
      if (el.hasAttribute("ssr")) {
        head.removeChild(el)
      }
    })
  }, [])

  return createElement(
    MainContext.Provider,
    { value: { url: pageUrl, setUrl, dataCache, ssrHeadCollection: ssr?.headCollection } },
    createElement(page.Component, { url: pageUrl })
  )
}

export const useRouter = (): { url: URL } => {
  const { url } = useContext(MainContext)
  return { url }
}

const E404 = () => {
  return createElement(
    "div",
    {
      style: {
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6
      }
    },
    createElement("strong", null, "404"),
    createElement("em", { style: { color: "#999" } }, "-"),
    "page not found"
  )
}

function loadSSRDataFromTag(): [any, number | undefined] {
  const ssrDataEl = self.document?.getElementById("ssr-data")
  if (ssrDataEl) {
    try {
      const ssrData = JSON.parse(ssrDataEl.innerText)
      const expires = ssrDataEl.getAttribute('data-expires')
      return [ssrData, parseInt(expires || '') || undefined]
    } catch (e) {
      console.error("ssr-data: invalid JSON")
    }
  }
  return [undefined, undefined]
}
