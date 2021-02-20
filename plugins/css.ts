import CleanCSS from 'https://esm.sh/clean-css@5.0.1?no-check'
import type { AcceptedPlugin } from 'https://esm.sh/postcss@8.2.4'
import PostCSS from 'https://esm.sh/postcss@8.2.4'
import { path } from '../deps.ts'
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
  let postcss: any = null
  let loading = (async () => {
    if (options?.postcss) {
      postcss = PostCSS(await loadPostcssPlugins(options.postcss.plugins))
      return
    }

    for (const name of Array.from(['ts', 'js', 'json']).map(ext => `postcss.config.${ext}`)) {
      const p = path.join(Deno.cwd(), name)
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
          postcss = PostCSS(await loadPostcssPlugins(config.plugins))
          return
        }
      }
    }

    postcss = PostCSS(await loadPostcssPlugins(['autoprefixer']))
  })()

  return {
    name: 'css-loader',
    type: 'loader',
    test: /\.p?css$/i,
    acceptHMR: true,
    async transform({ url, content }) {
      if (postcss == null) {
        await loading
      }
      const pcss = (await postcss!.process((new TextDecoder).decode(content)).async()).content
      const mini = Deno.env.get('BUILD_MODE') === 'production'
      const css = mini ? cleanCSS.minify(pcss).styles : pcss
      const js = [
        'import { applyCSS } from "https://deno.land/x/aleph/framework/core/style.ts"',
        `applyCSS(${JSON.stringify(url)}, ${JSON.stringify(css)})`
      ].join('\n')
      return {
        code: js,
        map: undefined // todo: generate map
      }
    }
  }
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
      return await importPostcssPlugin(p)
    } else if (Array.isArray(p)) {
      const Plugin = await importPostcssPlugin(p[0])
      return [Plugin, p[1]]
    } else {
      return p
    }
  }) || [])
}

async function importPostcssPlugin(name: string) {
  const { default: Plugin } = await import(`https://esm.sh/${name}?external=postcss@8.2.4&no-check`)
  return Plugin
}

function isPostcssConfig(v: any): v is { plugins: (string | [string, any] | AcceptedPlugin)[] } {
  return util.isPlainObject(v) && util.isArray(v.plugins)
}
