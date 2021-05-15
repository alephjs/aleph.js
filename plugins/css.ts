import { basename, extname, join } from 'https://deno.land/std@0.96.0/path/mod.ts'
import { esbuild } from '../bundler/esbuild.ts'
import { toLocalPath, computeHash } from '../server/helper.ts'
import util from '../shared/util.ts'
import { Measure } from '../shared/log.ts'
import type { LoaderPlugin, PostCSSPlugin } from '../types.ts'

const postcssVersion = '8.2.12'
const productionOnlyPostcssPlugins = ['autoprefixer']

export default (): LoaderPlugin => {
  let postcss: any = null
  let modulesJSON: Map<string, Record<string, string>> = new Map()

  return {
    name: 'css-loader',
    type: 'loader',
    test: /\.(css|pcss|postcss)$/i,
    acceptHMR: true,
    load: async ({ url, data }, app) => {
      const ms = new Measure()
      const { css: cssConfig } = app.config
      const isRemote = util.isLikelyHttpURL(url)

      if (isRemote && url.endsWith('.css') && cssConfig.remoteExternal) {
        return {
          code: [
            `import { applyCSS } from "https://deno.land/x/aleph/framework/core/style.ts"`,
            `export const href = ${JSON.stringify(url)}`,
            `export default {}`,
            `applyCSS(${JSON.stringify(url)}, { href })`,
          ].join('\n')
        }
      }

      if (postcss === null) {
        let plugins = cssConfig.postcss?.plugins || []
        if (util.isPlainObject(cssConfig.modules) || cssConfig.modules === true) {
          plugins = plugins.filter(p => {
            if (p === 'postcss-modules' || (Array.isArray(p) && p[0] === 'postcss-modules')) {
              return false
            }
            return true
          }) || []
          plugins.push(['postcss-modules', {
            ...(util.isPlainObject(cssConfig.modules) ? cssConfig.modules : {}),
            getJSON: (url: string, json: Record<string, string>) => {
              modulesJSON.set(url, json)
            },
          }])
        }
        postcss = await initPostCSS(plugins, app.mode === 'development')
        ms.stop('init postcss')
      }

      let sourceCode = ''
      let css = ''
      let cssModules: Record<string, string> = {}

      if (data instanceof Uint8Array) {
        sourceCode = (new TextDecoder).decode(data)
      } else if (util.isNEString(data)) {
        sourceCode = data
      } else {
        const { content } = await app.fetch(url)
        sourceCode = (new TextDecoder).decode(content)
      }

      // do not process remote css files
      if (isRemote && url.endsWith('.css')) {
        css = sourceCode
      } else {
        const ret = await postcss.process(sourceCode, { from: url }).async()
        css = ret.css
        if (modulesJSON.has(url)) {
          cssModules = modulesJSON.get(url)!
          modulesJSON.delete(url)
        }
      }

      if (app.mode === 'production') {
        const ret = await esbuild({
          stdin: {
            loader: 'css',
            sourcefile: url,
            contents: css // 3.6mb, tailwind.css
          },
          bundle: false,
          minify: true,
          write: false
        })
        css = util.trimSuffix(ret.outputFiles[0].text, '\n')
      }

      ms.stop(`process ${url}`)

      if (url.startsWith('#inline-style-')) {
        return { type: 'css', code: css }
      }

      const { extractSize = 8 * 1024 } = cssConfig
      if (css.length > extractSize) {
        const ext = extname(url)
        const hash = computeHash(css).slice(0, 8)
        const path = util.trimSuffix(isRemote ? toLocalPath(url) : url, ext) + '.' + hash + ext
        await app.addDist(path, (new TextEncoder).encode(css))
        return {
          code: [
            `import { applyCSS } from "https://deno.land/x/aleph/framework/core/style.ts"`,
            `export const href = ${JSON.stringify('/_aleph/' + util.trimPrefix(path, '/'))}`,
            `export default ${JSON.stringify(cssModules)}`,
            `applyCSS(${JSON.stringify(url)}, { href })`
          ].join('\n'),
          // todo: generate map
        }
      }

      return {
        code: [
          `import { applyCSS } from "https://deno.land/x/aleph/framework/core/style.ts"`,
          `export const css = ${JSON.stringify(css)}`,
          `export default ${JSON.stringify(cssModules)}`,
          `applyCSS(${JSON.stringify(url)}, { css })`,
        ].join('\n'),
        // todo: generate map
      }
    }
  }
}

async function initPostCSS(plugins: PostCSSPlugin[], isDev: boolean) {
  const pluginObjects = await Promise.all(plugins.filter(p => {
    if (isDev) {
      if (util.isNEString(p) && productionOnlyPostcssPlugins.includes(p)) {
        return false
      } else if (Array.isArray(p) && productionOnlyPostcssPlugins.includes(p[0])) {
        return false
      }
    }
    return true
  }).map(async p => {
    if (util.isNEString(p)) {
      return await importPostcssPluginByName(p)
    } else if (Array.isArray(p)) {
      const Plugin = await importPostcssPluginByName(p[0])
      if (util.isFunction(Plugin)) {
        return Plugin(p[1])
      }
      return null
    } else {
      return p
    }
  }))

  if (pluginObjects.length === 0) {
    return {
      process: (content: string) => ({
        async: async () => {
          return { css: content }
        }
      })
    }
  }

  const { default: PostCSS } = await import(`https://esm.sh/postcss@${postcssVersion}`)
  return PostCSS(pluginObjects)
}

async function importPostcssPluginByName(name: string) {
  const url = `https://esm.sh/${name}?deps=postcss@${postcssVersion}&no-check`
  const { default: Plugin } = await import(url)
  return Plugin
}
