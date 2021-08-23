import util from '../../shared/util.ts'
import type { RouterURL } from '../../types.d.ts'

const global = window as any
const lazySsrRoutes: Map<string, boolean> = new Map()

let staticSsrRoutes: Set<string> | null = null
export function setStaticSsrRoutes(routes: string[]) {
  staticSsrRoutes = new Set(routes)
}

export function shouldLoadPageData(url: RouterURL): boolean {
  const href = url.toString()
  const pagedataUrl = `pagedata://${href}`
  if (pagedataUrl in global) {
    const { expires, keys } = global[pagedataUrl]
    if (expires === 0 || Date.now() < expires) {
      return false
    }
    delete global[pagedataUrl]
    keys.forEach((key: string) => {
      delete global[`${pagedataUrl}#${key}`]
    })
  }
  if (staticSsrRoutes) {
    return staticSsrRoutes.has(url.routePath)
  }
  if (lazySsrRoutes.has(url.routePath)) {
    return lazySsrRoutes.get(url.routePath)!
  }
  return true
}

export async function loadPageData(url: RouterURL): Promise<void> {
  const href = url.toString()
  const basePath = util.trimSuffix(url.basePath, '/')
  const dataUrl = `${basePath}/_aleph/data/${util.btoaUrl(href)}.json`
  try {
    const resp = await fetch(dataUrl)
    if (resp.status === 200) {
      const data = await resp.json()
      if (util.isPlainObject(data)) {
        storeData(href, data)
        if (!staticSsrRoutes) {
          lazySsrRoutes.set(url.routePath, true)
        }
      }
    } else if (resp.status === 404) {
      if (!staticSsrRoutes) {
        lazySsrRoutes.set(url.routePath, false)
      }
    }
  } catch (err) {
    console.error('loadPageData:', err)
  }
}

export function loadSSRDataFromTag(url: RouterURL) {
  const href = url.toString()
  const ssrDataEl = global.document.getElementById('ssr-data')
  if (ssrDataEl) {
    try {
      const ssrData = JSON.parse(ssrDataEl.innerText)
      if (util.isPlainObject(ssrData)) {
        storeData(href, ssrData)
        return
      }
    } catch (e) {
      console.warn('ssr-data: invalid JSON')
    }
  }
}

function storeData(href: string, data: any) {
  let expires = 0
  for (const key in data) {
    const { expires: _expires } = data[key]
    if (expires === 0 || (_expires > 0 && _expires < expires)) {
      expires = _expires
    }
    global[`pagedata://${href}#${key}`] = data[key]
  }
  global[`pagedata://${href}`] = { expires, keys: Object.keys(data) }
}
