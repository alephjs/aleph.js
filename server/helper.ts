import { colors, createHash, path } from '../deps.ts'
import { existsDirSync } from '../shared/fs.ts'
import { moduleExts } from '../shared/constants.ts'
import log from '../shared/log.ts'
import util from '../shared/util.ts'
import { VERSION } from '../version.ts'

export const reLocaleID = /^[a-z]{2}(-[a-zA-Z0-9]+)?$/
export const reFullVersion = /@v?\d+\.\d+\.\d+/i
export const reHashJs = /\.[0-9a-fx]{9}\.js$/i
export const reHashResolve = /((?:[^a-z0-9_\.\$])from|import|import\s*\()(\s*)("|')([^'"]+\.[0-9a-fx]{9}\.js)("|')/g

// inject browser navigator polyfill
Object.assign(globalThis.navigator, {
  connection: {
    downlink: 10,
    effectiveType: "4g",
    onchange: null,
    rtt: 50,
    saveData: false,
  },
  cookieEnabled: false,
  deviceMemory: 8,
  hardwareConcurrency: 4,
  language: 'en',
  onLine: true,
  userAgent: `Deno/${Deno.version.deno}`,
  vendor: 'Deno Land',
  javaEnabled: () => false
})

export const AlephRuntimeCode = `
  var __ALEPH = window.__ALEPH || (window.__ALEPH = {
    pack: {},
    require: function(name) {
      switch (name) {
      case 'regenerator-runtime':
        return regeneratorRuntime
      default:
        throw new Error('module "' + name + '" is undefined')
      }
    },
  });
`

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
  let r = path.relative(from, to).split('\\').join('/')
  if (!r.startsWith('.') && !r.startsWith('/')) {
    r = './' + r
  }
  return r
}

export function trimModuleExt(url: string) {
  for (const ext of moduleExts) {
    if (url.endsWith('.' + ext)) {
      return url.slice(0, -(ext.length + 1))
    }
  }
  return url
}

/** fix remote import url to local */
export function toLocalUrl(url: string): string {
  const isRemote = util.isLikelyHttpURL(url)
  if (isRemote) {
    let { hostname, pathname, port, protocol, searchParams } = new URL(url)
    let search = Array.from(searchParams.entries()).map(([key, value]) => value ? `${key}=${value}` : key)
    if (search.length > 0) {
      pathname += '_' + search.join(',')
    }
    return [
      '/-/',
      (protocol === 'http:' ? 'http_' : ''),
      hostname,
      (port ? '_' + port : ''),
      pathname
    ].join('')
  }
  return url
}

/** compute hash of the content */
export function computeHash(content: string | Uint8Array): string {
  return createHash('sha1').update(content).toString()
}

/** clear the previous compilation cache */
export async function clearCompilation(jsFile: string) {
  const dir = path.dirname(jsFile)
  const jsFileName = path.basename(jsFile)
  if (!reHashJs.test(jsFile) || !existsDirSync(dir)) {
    return
  }
  const jsName = jsFileName.split('.').slice(0, -2).join('.') + '.js'
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && (entry.name.endsWith('.js') || entry.name.endsWith('.js.map'))) {
      const _jsName = util.trimSuffix(entry.name, '.map').split('.').slice(0, -2).join('.') + '.js'
      if (_jsName === jsName && jsFileName !== entry.name) {
        await Deno.remove(path.join(dir, entry.name))
      }
    }
  }
}

/** parse port number */
export function parsePortNumber(v: string): number {
  const num = parseInt(v)
  if (isNaN(num) || !Number.isInteger(num) || num <= 0 || num >= 1 << 16) {
    log.fatal(`invalid port '${v}'`)
  }
  return num
}

/** get flag value by given keys. */
export function getFlag(flags: Record<string, any>, keys: string[]): string | undefined
export function getFlag(flags: Record<string, any>, keys: string[], defaultValue: string): string
export function getFlag(flags: Record<string, any>, keys: string[], defaultValue?: string): string | undefined {
  let value = defaultValue
  for (const key of keys) {
    if (key in flags) {
      value = String(flags[key])
      break
    }
  }
  return value
}

/**
 * colorful the bytes string
 * - dim: 0 - 1MB
 * - yellow: 1MB - 10MB
 * - red: > 10MB
 */
export function formatBytesWithColor(bytes: number) {
  let cf = colors.dim
  if (bytes > 10 << 20) { // 10MB
    cf = colors.red
  } else if (bytes > 1 << 20) { // 1MB
    cf = colors.yellow
  }
  return cf(util.formatBytes(bytes))
}

/** create html content by given arguments */
export function createHtml({
  lang = 'en',
  head = [],
  scripts = [],
  body,
  minify = false
}: {
  lang?: string,
  head?: string[],
  scripts?: (string | { id?: string, type?: string, src?: string, innerText?: string, nomodule?: boolean, async?: boolean, preload?: boolean })[],
  body: string,
  minify?: boolean
}) {
  const eol = minify ? '' : '\n'
  const indent = minify ? '' : ' '.repeat(4)
  const headTags = head.map(tag => tag.trim()).concat(scripts.map(v => {
    if (!util.isString(v) && util.isNEString(v.src)) {
      if (v.type === 'module') {
        return `<link rel="modulepreload" href=${JSON.stringify(util.cleanPath(v.src))} />`
      } else if (!v.nomodule) {
        return `<link rel="preload" href=${JSON.stringify(util.cleanPath(v.src))} as="script" />`
      }
    }
    return ''
  })).filter(Boolean)
  const scriptTags = scripts.map(v => {
    if (util.isString(v)) {
      return `<script>${v}</script>`
    } else if (util.isNEString(v.innerText)) {
      const { innerText, ...rest } = v
      return `<script${formatAttrs(rest)}>${eol}${innerText}${eol}${indent}</script>`
    } else if (util.isNEString(v.src) && !v.preload) {
      return `<script${formatAttrs({ ...v, src: util.cleanPath(v.src) })}></script>`
    } else {
      return ''
    }
  }).filter(Boolean)

  return [
    '<!DOCTYPE html>',
    `<html lang="${lang}">`,
    '<head>',
    indent + '<meta charSet="utf-8" />',
    ...headTags.map(tag => indent + tag),
    '</head>',
    '<body>',
    indent + body,
    ...scriptTags.map(tag => indent + tag),
    '</body>',
    '</html>'
  ].join(eol)
}

function formatAttrs(v: any): string {
  return Object.keys(v).filter(k => !!v[k]).map(k => {
    if (v[k] === true) {
      return ` ${k}`
    } else {
      return ` ${k}=${JSON.stringify(String(v[k]))}`
    }
  }).join('')
}
