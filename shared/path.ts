import util from './util.ts'

export const builtinModuleExts = ['tsx', 'jsx', 'ts', 'js', 'mjs']

export function toPagePath(url: string): string {
  let pathname = trimBuiltinModuleExts(url)
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

export function trimBuiltinModuleExts(url: string) {
  for (const ext of builtinModuleExts) {
    if (url.endsWith('.' + ext)) {
      return url.slice(0, -(ext.length + 1))
    }
  }
  return url
}
