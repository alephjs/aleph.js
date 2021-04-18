import util from '../shared/util.ts'
import { PostCSSPlugin, CSSOptions } from '../types.ts'
import { esbuild } from './helper.ts'

const postcssVersion = '8.2.10'
const productionOnlyPostcssPlugins = ['autoprefixer']

export class CSSProcessor {
  #isProd: boolean
  #options: Required<CSSOptions>
  #postcss: any
  #modulesJSON: Map<string, Record<string, string>>

  constructor() {
    this.#isProd = false
    this.#options = {
      modules: false,
      postcss: { plugins: ['autoprefixer'] },
    }
    this.#postcss = null
    this.#modulesJSON = new Map()
  }

  config(isProd: boolean, options: CSSOptions) {
    this.#isProd = isProd
    if (util.isPlainObject(options.postcss) && Array.isArray(options.postcss.plugins)) {
      this.#options.postcss.plugins = options.postcss.plugins
    }
    if (util.isPlainObject(options.modules)) {
      const plugins = this.#options.postcss.plugins.filter(p => {
        if (p === 'postcss-modules' || (Array.isArray(p) && p[0] === 'postcss-modules')) {
          return false
        }
        return true
      })
      plugins.push(['postcss-modules', {
        ...options.modules,
        getJSON: (url: string, json: Record<string, string>) => {
          this.#modulesJSON.set(url, json)
        },
      }])
      this.#options.postcss.plugins = plugins
    }
  }

  async transform(url: string, content: string): Promise<{ code: string, map?: string, classNames?: Record<string, string> }> {
    if (util.isLikelyHttpURL(url)) {
      return {
        code: [
          `import { applyCSS } from "https://deno.land/x/aleph/framework/core/style.ts"`,
          `applyCSS(${JSON.stringify(url)})`,
          `export default { __url$: ${JSON.stringify(url)} }`
        ].join('\n')
      }
    }

    if (this.#postcss == null) {
      this.#postcss = await initPostCSS(this.#options.postcss.plugins)
    }

    const { content: pcss } = await this.#postcss.process(content, { from: url }).async()

    let css = pcss
    if (this.#isProd) {
      const ret = await esbuild({
        stdin: {
          loader: 'css',
          sourcefile: url,
          contents: pcss
        },
        minify: true,
        write: false,
        sourcemap: false,
      })
      css = ret.outputFiles[0].text
    }

    if (url.startsWith('#inline-style-')) {
      return {
        code: css,
        map: undefined
      }
    }

    const modulesJSON = this.#modulesJSON.get(url) || {}
    this.#modulesJSON.delete(url)

    return {
      code: [
        `import { applyCSS } from "https://deno.land/x/aleph/framework/core/style.ts"`,
        `const css = ${JSON.stringify(css)}`,
        `applyCSS(${JSON.stringify(url)}, css)`,
        `export default { __url$: ${JSON.stringify(url)}, __css$: css, ${util.trimSuffix(JSON.stringify(modulesJSON).slice(1), '}')}}`
      ].join('\n'),
      // todo: generate map
    }
  }
}

async function initPostCSS(plugins: PostCSSPlugin[]) {
  const { default: PostCSS } = await import(`https://esm.sh/postcss@${postcssVersion}`)
  const isDev = Deno.env.get('ALEPH_BUILD_MODE') === 'development'
  return PostCSS(await Promise.all(plugins.filter(p => {
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
  })))
}

async function importPostcssPluginByName(name: string) {
  const url = `https://esm.sh/${name}?deps=postcss@${postcssVersion}&no-check`
  const { default: Plugin } = await import(url)
  return Plugin
}
