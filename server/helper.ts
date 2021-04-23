import { dim, red, yellow } from 'https://deno.land/std@0.94.0/fmt/colors.ts'
import { createHash } from 'https://deno.land/std@0.94.0/hash/mod.ts'
import { relative } from 'https://deno.land/std@0.94.0/path/mod.ts'
import { existsDirSync } from '../shared/fs.ts'
import util from '../shared/util.ts'
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

/** get relative the path of `to` to `from`. */
export function getRelativePath(from: string, to: string): string {
  const r = relative(from, to).split('\\').join('/')
  if (!r.startsWith('.') && !r.startsWith('/')) {
    return './' + r
  }
  return r
}

/** fix remote import url to local */
export function toLocalUrl(url: string): string {
  if (util.isLikelyHttpURL(url)) {
    let { hostname, pathname, port, protocol, search } = new URL(url)
    const isHttp = protocol === 'http:'
    if ((isHttp && port === '80') || (protocol === 'https:' && port === '443')) {
      port = ''
    }
    if (search !== '') {
      const a = util.splitPath(pathname)
      const searchKey = btoa(search.slice(1)).replace(/[+/=]/g, '')
      const basename = `[${searchKey}]${a.pop()}`
      a.push(basename)
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
