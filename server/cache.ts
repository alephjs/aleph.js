import { ensureDir } from 'https://deno.land/std@0.92.0/fs/ensure_dir.ts'
import { createHash } from 'https://deno.land/std@0.92.0/hash/mod.ts'
import { join } from 'https://deno.land/std@0.92.0/path/mod.ts'
import { existsFileSync } from '../shared/fs.ts'
import util from '../shared/util.ts'
import log from '../shared/log.ts'
import { getDenoDir, reFullVersion } from './helper.ts'

/** download and cache remote content */
export async function cache(url: string, options?: { forceRefresh?: boolean, retryTimes?: number }) {
  const u = new URL(url)
  const { protocol, hostname, port, pathname, search } = u
  const isLocalhost = hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '172.0.0.1'
  const versioned = reFullVersion.test(pathname)
  const reload = !!options?.forceRefresh || !versioned
  const cacheDir = join(
    await getDenoDir(),
    'deps',
    util.trimSuffix(protocol, ':'),
    hostname + (port ? '_PORT' + port : '')
  )
  const hash = createHash('sha256').update(pathname + search).toString()
  const contentFile = join(cacheDir, hash)
  const metaFile = join(cacheDir, hash + '.metadata.json')

  if (!reload && !isLocalhost && existsFileSync(contentFile) && existsFileSync(metaFile)) {
    const [content, meta] = await Promise.all([
      Deno.readFile(contentFile),
      Deno.readTextFile(metaFile),
    ])
    try {
      const { headers = {} } = JSON.parse(meta)
      return {
        content,
        contentType: headers['Content-Type'] || null
      }
    } catch (e) { }
  }

  const retryTimes = options?.retryTimes || 3
  let err = new Error('Unknown')
  for (let i = 0; i < retryTimes; i++) {
    if (i === 0) {
      if (!isLocalhost) {
        log.info('Download', url)
      }
    } else {
      log.debug('Download error:', err)
      log.warn(`Download ${url} failed, retrying...`)
    }
    try {
      const resp = await fetch(u.toString())
      if (resp.status >= 400) {
        return Promise.reject(new Error(resp.statusText))
      }
      const buffer = await resp.arrayBuffer()
      const content = new Uint8Array(buffer)
      if (!isLocalhost) {
        const headers: Record<string, string> = {}
        resp.headers.forEach((val, key) => {
          headers[key] = val
        })
        await ensureDir(cacheDir)
        Deno.writeFile(contentFile, content)
        Deno.writeTextFile(metaFile, JSON.stringify({ headers, url }, undefined, 2))
      }
      return {
        content,
        contentType: resp.headers.get('Content-Type')
      }
    } catch (e) {
      err = e
    }
  }

  return Promise.reject(err)
}
