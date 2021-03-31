import util from '../../shared/util.ts'

export const moduleExts = ['tsx', 'jsx', 'ts', 'js', 'mjs']

export function toPagePath(url: string): string {
  let pathname = trimModuleExt(url)
  if (pathname.startsWith('/pages/')) {
    pathname = util.trimPrefix(pathname, '/pages')
  }
  if (pathname.endsWith('/index')) {
    pathname = util.trimSuffix(pathname, '/index')
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
  const { __ALEPH: ALEPH } = window as any

  if (ALEPH) {
    return ALEPH.import(url, forceRefetch)
  }

  let src = util.cleanPath(baseUrl + '/_aleph/' + trimModuleExt(url) + '.js')
  if (forceRefetch) {
    src += '?t=' + Date.now()
  }
  return import(src)
}
