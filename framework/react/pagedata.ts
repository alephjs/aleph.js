import util from '../../shared/util.ts'
import type { RouterURL } from '../../types.ts'
import { importModule } from '../core/module.ts'
import type { PageProps } from './pageprops.ts'
import { createPageProps } from './pageprops.ts'

const global = window as any

export async function loadPage(url: RouterURL, nestedModules: string[], refresh = false): Promise<PageProps & { url: RouterURL }> {
  if (refresh) {
    await loadPageData(url)
  } else {
    loadSSRDataFromTag(url)
  }
  const imports = nestedModules.map(async specifier => {
    const { default: Component } = await importModule(url.basePath, specifier, refresh)
    const data = (window as any)[`pagedata://${url.toString()}#props-${btoa(specifier)}`] || {}
    return {
      specifier,
      Component,
      props: { ...data.value }
    }
  })
  return { ...createPageProps(await Promise.all(imports)), url }
}

export async function loadPageData(url: RouterURL): Promise<void> {
  const href = url.toString()
  const pagedataUrl = 'pagedata://' + href
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
  const dataUrl = `${basePath}/_aleph/data/${util.btoaUrl(href)}.json`
  const data = await fetch(dataUrl).then(resp => resp.json())
  if (util.isPlainObject(data)) {
    storeData(href, data)
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
    } catch (e) { }
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
