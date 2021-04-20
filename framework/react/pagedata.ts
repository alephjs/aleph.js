import util from '../../shared/util.ts'
import type { RouterURL } from '../../types.ts'

const global = window as any

export async function loadPageData({ basePath, slug }: RouterURL) {
  const url = 'pagedata://' + slug
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
  const dataUrl = `${util.trimSuffix(basePath, '/')}/_aleph/data/${encodeURIComponent(slug)}.json`
  const data = await (await fetch(dataUrl)).json()
  if (util.isPlainObject(data)) {
    storeData(data, slug)
  }
}

export async function loadPageDataFromTag(url: RouterURL) {
  const ssrDataEl = global.document.getElementById('ssr-data')
  if (ssrDataEl) {
    try {
      const ssrData = JSON.parse(ssrDataEl.innerText)
      if (util.isPlainObject(ssrData)) {
        storeData(ssrData, url.slug)
        return
      }
    } catch (e) { }
  }
  await loadPageData(url)
}

function storeData(data: any, slug: string) {
  let expires = 0
  for (const key in data) {
    const { expires: _expires } = data[key]
    if (expires === 0 || (_expires > 0 && _expires < expires)) {
      expires = _expires
    }
    global[`pagedata://${slug}#${key}`] = data[key]
  }
  global[`pagedata://${slug}`] = { expires, keys: Object.keys(data) }
}
