import { extname, join } from 'https://deno.land/std@0.106.0/path/mod.ts'
import { esbuild, esmLoader } from '../bundler/esbuild.ts'
import { toLocalPath, computeHash } from '../server/helper.ts'
import { existsFile } from '../shared/fs.ts'
import log, { Measure } from '../shared/log.ts'
import util from '../shared/util.ts'
import type { Aleph, LoadInput, LoadOutput, Plugin, PostCSSPlugin } from '../types.d.ts'

const test = /\.(css|pcss|postcss)$/i
const postcssVersion = '8.3.6'
const postcssModulesVersion = '4.1.3'
const productionOnlyPostcssPlugins = ['autoprefixer']
const isModulesPluginName = (v: any): v is string => (typeof v === 'string' && /^postcss\-modules(@|$)/i.test(v.trim()))

/** builtin css loader */
export const cssLoader = async ({ specifier, data }: LoadInput, aleph: Aleph): Promise<LoadOutput> => {
  const ms = new Measure()
  const { css: cssConfig } = aleph.config
  const isRemote = util.isLikelyHttpURL(specifier)

  // Don't process remote .css files if the cache is disabled
  if (
    (isRemote && specifier.endsWith('.css')) &&
    (
      cssConfig.cache === false ||
      (cssConfig.cache instanceof RegExp && !cssConfig.cache.test(specifier)) ||
      (Array.isArray(cssConfig.cache) && !cssConfig.cache.some(r => r.test(specifier)))
    )
  ) {
    return {
      code: [
        `import { applyCSS } from "https://deno.land/x/aleph/framework/core/style.ts"`,
        `export const href = ${JSON.stringify(specifier)}`,
        `export default {}`,
        `applyCSS(${JSON.stringify(specifier)}, { href })`,
      ].join('\n')
    }
  }

  // Don't process .css files in ./public folder
  if (
    !isRemote &&
    specifier.endsWith('.css') &&
    !(await existsFile(join(aleph.workingDir, specifier))) &&
    await existsFile(join(aleph.workingDir, 'public', specifier))
  ) {
    return {
      code: [
        `import { applyCSS } from "https://deno.land/x/aleph/framework/core/style.ts"`,
        `export const href = ${JSON.stringify(specifier)}`,
        `export default {}`,
        `applyCSS(${JSON.stringify(specifier)}, { href })`,
      ].join('\n')
    }
  }

  let sourceCode = ''
  let css = ''

  if (data instanceof Uint8Array) {
    sourceCode = (new TextDecoder).decode(data)
  } else if (util.isFilledString(data)) {
    sourceCode = data
  } else {
    const { content } = await aleph.fetchModule(specifier)
    sourceCode = (new TextDecoder).decode(content)
  }

  let postPlugins = cssConfig.postcss.plugins || []
  let modulesJSON: Record<string, string> = {}
  if (/\.module\.[a-z]+$/.test(specifier)) {
    const options = {
      ...(util.isPlainObject(cssConfig.modules) ? cssConfig.modules : {}),
      getJSON: (_specifier: string, json: Record<string, string>) => {
        modulesJSON = json
      },
    }
    let hasModulesPlugin = false
    postPlugins = postPlugins.map(plugin => {
      if (isModulesPluginName(plugin)) {
        hasModulesPlugin = true
        return [plugin.trim().toLowerCase(), options]
      }
      if (Array.isArray(plugin) && isModulesPluginName(plugin[0])) {
        hasModulesPlugin = true
        return [plugin[0].trim().toLowerCase(), { ...options, ...plugin[1] }]
      }
      return plugin
    })
    if (!hasModulesPlugin) {
      postPlugins.push([`postcss-modules@${postcssModulesVersion}`, options])
    }
  }

  // init postcss with plugins
  const postcss = await initPostCSS(postPlugins, aleph.mode === 'development')

  // postcss: don't process large(>64k) remote css files
  if (isRemote && specifier.endsWith('.css') && !specifier.endsWith('.module.css') && sourceCode.length > 64 * 1024) {
    css = sourceCode
  } else if (postcss !== null) {
    try {
      const ret = await postcss.process(sourceCode, { from: specifier }).async()
      css = ret.css
    } catch (err) {
      css = sourceCode
      log.warn('postcss:', err.message || err)
    }
  } else {
    css = sourceCode
  }

  if (!Deno.env.get('DENO_TESTING')) {
    try {
      const ret = await esbuild({
        stdin: {
          loader: 'css',
          sourcefile: specifier,
          contents: css
        },
        write: false,
        bundle: true,
        minify: aleph.mode === 'production',
        plugins: [esmLoader],
      })
      css = util.trimSuffix(ret.outputFiles[0].text, '\n')
    } catch (e) { }
  }

  ms.stop(`process ${specifier}`)

  if (specifier.startsWith('#inline-style-')) {
    return { type: 'css', code: css }
  }

  return {
    code: [
      `import { applyCSS } from "https://deno.land/x/aleph/framework/core/style.ts"`,
      `export const css = ${JSON.stringify(css)}`,
      `export default ${JSON.stringify(modulesJSON)}`,
      `applyCSS(${JSON.stringify(specifier)}, { css })`,
    ].join('\n'),
    // todo: generate map
  }
}

export const isCSS = (specifier: string): boolean => test.test(specifier)

async function initPostCSS(plugins: PostCSSPlugin[], isDev: boolean) {
  const postPlugins = await Promise.all(plugins.filter(p => {
    if (isDev) {
      if (util.isFilledString(p) && productionOnlyPostcssPlugins.includes(p)) {
        return false
      } else if (Array.isArray(p) && productionOnlyPostcssPlugins.includes(p[0])) {
        return false
      }
    }
    return true
  }).map(async p => {
    if (util.isFilledString(p)) {
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

  if (postPlugins.length === 0) {
    return null
  }

  const { default: PostCSS } = await import(`https://esm.sh/postcss@${postcssVersion}?no-check`)
  return PostCSS(postPlugins)
}

async function importPostcssPluginByName(name: string) {
  const url = `https://esm.sh/${name}?deps=postcss@${postcssVersion}&no-check`
  const { default: Plugin } = await import(url)
  return Plugin
}

export default (): Plugin => {
  return {
    name: 'css-loader',
    setup: aleph => {
      aleph.onResolve(test, () => ({ acceptHMR: true }))
    }
  }
}
