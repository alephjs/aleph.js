import CleanCSS from 'https://esm.sh/clean-css@5.1.1?no-check'
import PostCSS, { AcceptedPlugin } from 'https://esm.sh/postcss@8.2.7'
import { join } from 'https://deno.land/std@0.90.0/path/mod.ts'
import { existsFileSync } from '../shared/fs.ts'
import util from '../shared/util.ts'
import type { LoaderPlugin } from '../types.ts'

const cleanCSS = new CleanCSS({ compatibility: '*' /* Internet Explorer 10+ */ })
const productionOnlyPostcssPlugins = ['autoprefixer']

type Options = {
  postcss?: {
    plugins: (string | [string, any] | AcceptedPlugin)[]
  }
}

export default (options?: Options): LoaderPlugin => {
  const decoder = new TextDecoder()
  let pcssProcessor: any = null

  return {
    name: 'css-loader',
    type: 'loader',
    test: /\.p?css$/i,
    acceptHMR: true,
    async transform({ url, content }) {
      if (pcssProcessor == null) {
        pcssProcessor = await initPostCSSProcessor(options)
      }
      const { content: pcss } = await pcssProcessor.process(decoder.decode(content)).async()
      const css = Deno.env.get('BUILD_MODE') === 'production' ? cleanCSS.minify(pcss).styles : pcss
      if (url.startsWith('#inline-style-')) {
        return {
          code: css,
          type: 'css',
          map: undefined
        }
      }
      return {
        code: [
          'import { applyCSS } from "https://deno.land/x/aleph/framework/core/style.ts"',
          `applyCSS(${JSON.stringify(url)}, ${JSON.stringify(css)})`
        ].join('\n'),
        map: undefined // todo: generate map
      }
    }
  }
}

async function initPostCSSProcessor(options?: Options) {
  if (options?.postcss) {
    return PostCSS(await loadPostcssPlugins(options.postcss.plugins))
  }

  for (const name of Array.from(['ts', 'js', 'json']).map(ext => `postcss.config.${ext}`)) {
    const p = join(Deno.cwd(), name)
    if (existsFileSync(p)) {
      let config: any = null
      if (name.endsWith('.json')) {
        config = JSON.parse(await Deno.readTextFile(p))
      } else {
        const mod = await import('file://' + p)
        config = mod.default
        if (util.isFunction(config)) {
          config = await config()
        }
      }
      if (isPostcssConfig(config)) {
        return PostCSS(await loadPostcssPlugins(config.plugins))
      }
    }
  }

  return PostCSS(await loadPostcssPlugins(['autoprefixer']))
}

async function loadPostcssPlugins(plugins: (string | [string, any] | AcceptedPlugin)[]) {
  const isDev = Deno.env.get('BUILD_MODE') === 'development'
  return await Promise.all(plugins.filter(p => {
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
      return [Plugin, p[1]]
    } else {
      return p
    }
  }))
}

async function importPostcssPluginByName(name: string) {
  const { default: Plugin } = await import(`https://esm.sh/${name}?external=postcss@8.2.4&no-check`)
  return Plugin
}

function isPostcssConfig(v: any): v is { plugins: (string | [string, any] | AcceptedPlugin)[] } {
  return util.isPlainObject(v) && util.isArray(v.plugins)
}
