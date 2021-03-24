import util from '../../shared/util.ts'
import type { RouterURL } from '../../types.ts'

const global = window as any

export async function loadPageData({ baseURL, pathname }: RouterURL) {
  const url = `pagedata://${pathname}`
  if (url in global) {
    const { expires, keys } = global[url]
    if (expires === 0 || Date.now() < expires) {
      return
    }
    delete global[url]
    keys.forEach((key: string) => {
      delete global[`${url}#${key}`]
    })
  }
  const dataUrl = `${util.trimSuffix(baseURL, '/')}/_aleph/data${pathname === '/' ? '/index' : pathname}.json`
  const data = await (await fetch(dataUrl)).json()
  if (util.isPlainObject(data)) {
    storeData(data, pathname)
  }
}

export async function loadPageDataFromTag(url: RouterURL) {
  const ssrDataEl = global.document.getElementById('ssr-data')
  if (ssrDataEl) {
    try {
      const ssrData = JSON.parse(ssrDataEl.innerText)
      if (util.isPlainObject(ssrData)) {
        storeData(ssrData, url.pathname)
        return
      }
    } catch (e) { }
  }
  await loadPageData(url)
}

function storeData(data: any, pathname: string) {
  let expires = 0
  for (const key in data) {
    const { expires: _expires } = data[key]
    if (expires === 0 || (_expires > 0 && _expires < expires)) {
      expires = _expires
    }
    global[`pagedata://${pathname}#${key}`] = data[key]
  }
  global[`pagedata://${pathname}`] = { expires, keys: Object.keys(data) }
}
