import { createContext } from 'https://esm.sh/react'
import util from '../../shared/util.ts'
import { moduleExts } from '../../shared/constants.ts'
import type { RouterURL } from '../../types.ts'

const symbolFor = typeof Symbol === 'function' && Symbol.for
const REACT_FORWARD_REF_TYPE = symbolFor ? Symbol.for('react.forward_ref') : 0xead0
const REACT_MEMO_TYPE = symbolFor ? Symbol.for('react.memo') : 0xead3

export function isLikelyReactComponent(type: any): Boolean {
  switch (typeof type) {
    case 'function':
      if (type.prototype != null) {
        if (type.prototype.isReactComponent) {
          return true
        }
        const ownNames = Object.getOwnPropertyNames(type.prototype)
        if (ownNames.length > 1 || ownNames[0] !== 'constructor') {
          return false
        }
      }
      const { __ALEPH: ALEPH } = window as any
      if (ALEPH) {
        // in bundle mode, the component names have been compressed.
        return true
      }
      const name = type.displayName || type.name
      return typeof name === 'string' && /^[A-Z]/.test(name)
    case 'object':
      if (type != null) {
        switch (type.$$typeof) {
          case REACT_FORWARD_REF_TYPE:
          case REACT_MEMO_TYPE:
            return true
          default:
            return false
        }
      }
      return false
    default:
      return false
  }
}

export function trimModuleExt(url: string) {
  for (const ext of moduleExts) {
    if (url.endsWith('.' + ext)) {
      return url.slice(0, -(ext.length + 1))
    }
  }
  return url
}

export function importModule(baseUrl: string, url: string, forceRefetch = false): Promise<any> {
  const { __ALEPH: ALEPH, document } = window as any

  if (ALEPH && url in ALEPH.pack) {
    return Promise.resolve(ALEPH.pack[url])
  }

  if (ALEPH && url.startsWith('/pages/')) {
    const src = util.cleanPath(baseUrl + '/_aleph/' + trimModuleExt(url) + '.js')
    return new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.onload = () => {
        resolve(ALEPH.pack[url])
      }
      script.onerror = (err: Error) => {
        reject(err)
      }
      script.src = src
      document.body.appendChild(script)
    })
  }

  const src = util.cleanPath(baseUrl + '/_aleph/' + trimModuleExt(url) + `.js`) + (forceRefetch ? `?t=${Date.now()}` : '')
  return import(src)
}

export async function loadPageData({ pathname }: RouterURL): Promise<void> {
  const url = `/_aleph/data${pathname === '/' ? '/index' : pathname}.json`
  const data = await fetch(url).then(resp => resp.json())
  if (util.isPlainObject(data)) {
    for (const key in data) {
      Object.assign(window, { [`data://${pathname}#${key}`]: data[key] })
    }
  }
}

export async function loadPageDataFromTag(url: RouterURL) {
  const { document } = window as any
  const ssrDataEl = document.getElementById('ssr-data')
  if (ssrDataEl) {
    try {
      const ssrData = JSON.parse(ssrDataEl.innerText)
      for (const key in ssrData) {
        Object.assign(window, { [`data://${url.pathname}#${key}`]: ssrData[key] })
      }
      return
    } catch (e) { }
  }
  await loadPageData(url)
}

export function createNamedContext<T>(defaultValue: T, name: string) {
  const ctx = createContext<T>(defaultValue)
  ctx.displayName = name // show in devTools
  return ctx
}
