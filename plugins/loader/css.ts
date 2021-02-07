import CleanCSS from 'https://esm.sh/clean-css@5.0.1?no-check'
import type { AcceptedPlugin } from 'https://esm.sh/postcss@8.2.4'
import postcss from 'https://esm.sh/postcss@8.2.4'
import { path } from '../../deps.ts'
import { existsFileSync } from '../../shared/fs.ts'
import util from '../../shared/util.ts'
import type { LoaderPlugin } from '../../types.ts'

const cleanCSS = new CleanCSS({ compatibility: '*' /* Internet Explorer 10+ */ })

type Options = {
  postcss?: {
    plugins: (string | [string, any] | AcceptedPlugin)[]
  }
}

export default (options?: Options): LoaderPlugin => {
  let postcssPlugins: AcceptedPlugin[] = []

  return {
    name: 'css-loader',
    type: 'loader',
    test: /\.p?css$/i,
    acceptHMR: true,
    async init() {
      if (options?.postcss) {
        postcssPlugins = await loadPostcssPlugins(options.postcss.plugins)
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
            postcssPlugins = await loadPostcssPlugins(config.plugins)
            return
          }
        }
      }

      postcssPlugins = await loadPostcssPlugins(['autoprefixer'])
      return
    },
    async transform({ content, url, bundleMode }) {
      const { stringify } = JSON
      const pcss = (await postcss(postcssPlugins).process((new TextDecoder).decode(content)).async()).content
      const mini = Deno.env.get('BUILD_MODE') === 'production'
      const css = mini ? cleanCSS.minify(pcss).styles : pcss
      const appyCSS = `applyCSS(${stringify(url)}, ${stringify(css)})`
      const js = [
        'import { applyCSS } from "https://deno.land/x/aleph/framework/core/style.ts"',
        bundleMode
          ? `__ALEPH.pack[${stringify(url)}] = { default: () => ${appyCSS} }`
          : appyCSS
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
      if (p === 'autoprefixer') {
        return false
      } else if (Array.isArray(p) && p[0] === 'autoprefixer') {
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
