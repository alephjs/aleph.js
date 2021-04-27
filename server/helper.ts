import { dim, red, yellow } from 'https://deno.land/std@0.94.0/fmt/colors.ts'
import { createHash } from 'https://deno.land/std@0.94.0/hash/mod.ts'
import { dirname, basename, extname, join, relative } from 'https://deno.land/std@0.94.0/path/mod.ts'
import { existsDirSync } from '../shared/fs.ts'
import util from '../shared/util.ts'
import { SourceType } from '../compiler/mod.ts'
import type { ServerPlugin, LoaderPlugin } from '../types.ts'
import { VERSION } from '../version.ts'
import { localProxy } from './localproxy.ts'

export const reLocaleID = /^[a-z]{2}(-[a-zA-Z0-9]+)?$/
export const reFullVersion = /@v?\d+\.\d+\.\d+/i

export const moduleWalkOptions = {
  includeDirs: false,
  skip: [
    /(^|\/|\\)\./,
    /\.d\.ts$/i,
    /(\.|_)(test|spec|e2e)\.[a-z]+$/i
  ]
}

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

let __denoDir: string | null = null
let __localProxy = false

/** check whether should proxy https://deno.land/x/aleph on localhost. */
export function checkAlephDev() {
  const v = Deno.env.get('ALEPH_DEV')
  if (v !== undefined && !__localProxy) {
    localProxy(Deno.cwd(), 2020)
    __localProxy = true
  }
}

/** check the plugin whether it is a loader. */
export function isLoaderPlugin(plugin: LoaderPlugin | ServerPlugin): plugin is LoaderPlugin {
  return plugin.type === 'loader'
}

/** get the deno cache dir. */
export async function getDenoDir() {
  if (__denoDir !== null) {
    return __denoDir
  }

  const p = Deno.run({
    cmd: [Deno.execPath(), 'info', '--json', '--unstable'],
    stdout: 'piped',
    stderr: 'null'
  })
  const output = (new TextDecoder).decode(await p.output())
  const { denoDir } = JSON.parse(output)
  p.close()
  if (denoDir === undefined || !existsDirSync(denoDir)) {
    throw new Error(`can't find the deno dir`)
  }
  __denoDir = denoDir
  return denoDir
}

/** get aleph pkg uri. */
export function getAlephPkgUri() {
  const DEV_PORT = Deno.env.get('ALEPH_DEV_PORT')
  if (DEV_PORT) {
    return `http://localhost:${DEV_PORT}`
  }
  return `https://deno.land/x/aleph@v${VERSION}`
}

/** get the relative path from `from` to `to`. */
export function getRelativePath(from: string, to: string): string {
  const r = relative(from, to).split('\\').join('/')
  if (!r.startsWith('.') && !r.startsWith('/')) {
    return './' + r
  }
  return r
}

/** get source type by given url and content type. */
export function getSourceType(url: string, contentType: string): SourceType {
  switch (contentType.split(';')[0].trim()) {
    case 'application/javascript':
    case 'text/javascript':
      return SourceType.JS
    case 'text/jsx':
      return SourceType.JSX
    case 'text/typescript':
      return SourceType.TS
    case 'text/tsx':
      return SourceType.TSX
    case 'text/css':
      return SourceType.CSS
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
      const ext = extname(basename)
      const search64 = util.btoaUrl(search.slice(1))
      a.push(util.trimSuffix(basename, ext) + `.${search64}` + ext)
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

/** compute hash of the content */
export function computeHash(content: string | Uint8Array): string {
  return createHash('sha1').update(content).toString()
}

/**
 * coloring the bytes string
 * - dim: 0 - 1MB
 * - yellow: 1MB - 10MB
 * - red: > 10MB
 */
export function formatBytesWithColor(bytes: number) {
  let cf = dim
  if (bytes > 10 << 20) { // 10MB
    cf = red
  } else if (bytes > 1 << 20) { // 1MB
    cf = yellow
  }
  return cf(util.formatBytes(bytes))
}

export async function clearBuildCache(filename: string, ext = 'js') {
  const dir = dirname(filename)
  const hashname = basename(filename)
  const regHashExt = new RegExp(`\\.[0-9a-f]+\\.${ext}$`, 'i')
  if (ext && !regHashExt.test(hashname) || !existsDirSync(dir)) {
    return
  }

  const jsName = hashname.split('.').slice(0, -2).join('.') + '.' + ext
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && regHashExt.test(entry.name)) {
      const _jsName = entry.name.split('.').slice(0, -2).join('.') + '.' + ext
      if (_jsName === jsName && hashname !== entry.name) {
        await Deno.remove(join(dir, entry.name))
      }
    }
  }
}
