import util from '../../shared/util.ts'
import type { RouterURL } from '../../types.d.ts'

const global = window as any
const lazyDataRoutes: Map<string, boolean> = new Map()

let staticDataRoutes: Set<string> | null = null

export function setStaticDataRoutes(routes: string[]) {
  staticDataRoutes = new Set(routes)
}

export async function shouldLoadData(url: RouterURL): Promise<boolean> {
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
  if (staticDataRoutes) {
    return staticDataRoutes.has(url.routePath)
  }
  if (lazyDataRoutes.has(url.routePath)) {
    return lazyDataRoutes.get(url.routePath)!
  }
  // load data anyway
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
      if (data === null) {
        if (!staticDataRoutes) {
          lazyDataRoutes.set(url.routePath, false)
        }
      } else if (util.isPlainObject(data)) {
        storeData(href, data)
        if (!staticDataRoutes) {
          lazyDataRoutes.set(url.routePath, true)
        }
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
