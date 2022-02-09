import { dim, red, yellow } from 'https://deno.land/std@0.125.0/fmt/colors.ts'
import { dirname, basename, extname, join, relative } from 'https://deno.land/std@0.125.0/path/mod.ts'
import { existsDir } from '../shared/fs.ts'
import log from '../shared/log.ts'
import util from '../shared/util.ts'
import { SourceType } from '../compiler/mod.ts'
import { VERSION } from '../version.ts'

const minDenoVersion = "1.18.2"

// inject browser navigator polyfill
Object.assign((globalThis as any).navigator, {
  connection: {
    downlink: 10,
    effectiveType: '4g',
    onchange: null,
    rtt: 50,
    saveData: false,
  },
  cookieEnabled: false,
  language: 'en',
  languages: ['en'],
  onLine: true,
  platform: Deno.build.os,
  userAgent: `Deno/${Deno.version.deno}`,
  vendor: 'Deno Land'
})

export const encoder = new TextEncoder()
export const decoder = new TextDecoder()
export const moduleExclude = [
  /(^|\/|\\)\./,
  /\.d\.ts$/i,
  /(\.|_)(test|spec|e2e)\.[a-z]+$/i
]

const reLocalhostUrl = /^https?:\/\/(localhost|0\.0\.0\.0|127\.0\.0\.1)(\:|\/|$)/
const reEndsWithVersion = /@\d+(\.\d+){0,2}(\-[a-z0-9]+(\.[a-z0-9]+)?)?$/

export function checkDenoVersion() {
  const [currentMajor, currentMinor, currentPatch] = Deno.version.deno.split('.').map(p => parseInt(p))
  const [major, minor, patch] = minDenoVersion.split('.').map(p => parseInt(p))

  if (currentMajor > major) return
  if (currentMajor === major && currentMinor > minor) return
  if (currentMajor === major && currentMinor === minor && currentPatch >= patch) return

  log.error(`Aleph.js needs Deno ${minDenoVersion}+, please upgrade Deno.`)
  Deno.exit(1)
}

/** check whether it is a localhost url. */
export function isLocalhostUrl(url: string): boolean {
  return reLocalhostUrl.test(url)
}

/** get the relative path from `from` to `to`. */
export function toRelativePath(from: string, to: string): string {
  const p = relative(from, to).replaceAll('\\', '/')
  if (!p.startsWith('.') && !p.startsWith('/')) {
    return './' + p
  }
  return p
}

/** get source type by given url and content type. */
export function getSourceType(url: string, contentType?: string): SourceType {
  if (util.isFilledString(contentType)) {
    switch (contentType.split(';')[0].trim()) {
      case 'application/javascript':
      case 'text/javascript':
        return SourceType.JS
      case 'text/jsx':
        return SourceType.JSX
      case 'text/typescript':
        if (url.endsWith('.tsx')) {
          return SourceType.TSX
        }
        return SourceType.TS
      case 'text/tsx':
        return SourceType.TSX
      case 'text/css':
        return SourceType.CSS
    }
  }
  switch (extname(url)) {
    case '.mjs':
    case '.js':
      return SourceType.JS
    case '.jsx':
      return SourceType.JSX
    case '.ts':
      return SourceType.TS
    case '.tsx':
      return SourceType.TSX
    case '.css':
      return SourceType.CSS
  }
  return SourceType.Unknown
}

/**
 * fix remote import url to local
 * https://esm.sh/react.js?bundle -> /-/esm.sh/react.YnVuZGxl.js
 */
export function toLocalPath(url: string): string {
  if (util.isLikelyHttpURL(url)) {
    let { hostname, pathname, port, protocol, search } = new URL(url)
    const isHttp = protocol === 'http:'
    if ((isHttp && port === '80') || (protocol === 'https:' && port === '443')) {
      port = ''
    }
    if (search !== '') {
      const a = util.splitPath(pathname)
      const basename = a.pop()!
      const realext = extname(basename)
      const ext = realext != "" && !basename.match(reEndsWithVersion) ? realext : "js"
      const search64 = util.btoaUrl(search.slice(1))
      a.push(util.trimSuffix(basename, ext) + `.${search64}.` + ext)
      pathname = '/' + a.join('/')
    }
    return [
      '/-/',
      (isHttp ? 'http_' : ''),
      hostname,
      (port ? '_' + port : ''),
      pathname
    ].join('')
  }
  return util.trimPrefix(url, 'file://')
}

export function toHex(buf: ArrayBuffer) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("")
}

/** compute hash of the content */
export async function computeHash(algorithm: AlgorithmIdentifier, content: string | Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest(algorithm, typeof content === 'string' ? encoder.encode(content) : content)
  return toHex(buf)
}

/**
 * coloring the bytes string
 * - dim: 0 - 1MB
 * - yellow: 1MB - 10MB
 * - red: > 10MB
 */
export function prettyBytesWithColor(bytes: number) {
  let cf = dim
  if (bytes > 10 << 20) { // 10MB
    cf = red
  } else if (bytes > 1 << 20) { // 1MB
    cf = yellow
  }
  return cf(util.prettyBytes(bytes))
}
