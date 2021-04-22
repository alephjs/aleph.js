import util from '../../shared/util.ts'
import type { RouterURL } from '../../types.ts'

const global = window as any

export async function loadPageData(url: RouterURL) {
  const fullPath = util.fullPath(url)
  const pagedataUrl = 'pagedata://' + fullPath
  if (pagedataUrl in global) {
    const { expires, keys } = global[pagedataUrl]
    if (expires === 0 || Date.now() < expires) {
      return
    }
    delete global[pagedataUrl]
    keys.forEach((key: string) => {
      delete global[`${pagedataUrl}#${key}`]
    })
  }
  const basePath = util.trimSuffix(url.basePath, '/')
  const dataUrl = `${basePath}/_aleph/data/${btoa(fullPath)}.json`
  const data = await (await fetch(dataUrl)).json()
  if (util.isPlainObject(data)) {
    storeData(data, fullPath)
  }
}

export async function loadPageDataFromTag(url: RouterURL) {
  const fullPath = util.fullPath(url)
  const ssrDataEl = global.document.getElementById('ssr-data')
  if (ssrDataEl) {
    try {
      const ssrData = JSON.parse(ssrDataEl.innerText)
      if (util.isPlainObject(ssrData)) {
        storeData(ssrData, fullPath)
        return
      }
    } catch (e) { }
  }
  await loadPageData(url)
}

function storeData(data: any, fullPath: string) {
  let expires = 0
  for (const key in data) {
    const { expires: _expires } = data[key]
    if (expires === 0 || (_expires > 0 && _expires < expires)) {
      expires = _expires
    }
    global[`pagedata://${fullPath}#${key}`] = data[key]
  }
  global[`pagedata://${fullPath}`] = { expires, keys: Object.keys(data) }
}
