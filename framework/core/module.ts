import util from '../../shared/util.ts'

export const moduleExts = ['tsx', 'jsx', 'ts', 'js', 'mjs']

export function toPagePath(url: string): string {
  let pathname = trimModuleExt(url)
  if (pathname.startsWith('/pages/')) {
    pathname = util.trimPrefix(pathname, '/pages')
  }
  if (pathname.endsWith('/index')) {
    pathname = util.trimSuffix(pathname, 'index')
  }
  if (pathname === '') {
    pathname = '/'
  }
  return pathname
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
