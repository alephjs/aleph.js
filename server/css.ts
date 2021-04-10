import util from '../shared/util.ts'
import { PostCSSPlugin, CSSOptions } from '../types.ts'

const postcssVersion = '8.2.8'
const productionOnlyPostcssPlugins = ['autoprefixer']

export class CSSProcessor {
  #isProd: boolean
  #options: Required<CSSOptions>
  #postcss: any
  #cleanCSS: any
  #modulesJSON: Record<string, Record<string, string>>

  constructor() {
    this.#isProd = false
    this.#options = {
      modules: false,
      postcss: { plugins: ['autoprefixer'] },
    }
    this.#postcss = null
    this.#cleanCSS = null
    this.#modulesJSON = {}
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
          this.#modulesJSON = { [url]: json }
        },
      }])
      this.#options.postcss.plugins = plugins
    }
  }

  private getModulesJSON(url: string) {
    const json = this.#modulesJSON[url] || {}
    if (url in this.#modulesJSON) {
      delete this.#modulesJSON[url]
    }
    return json
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
      const [postcss, cleanCSS] = await Promise.all([
        initPostCSS(this.#options.postcss.plugins),
        this.#isProd ? initCleanCSS() : Promise.resolve(null)
      ])
      this.#postcss = postcss
      this.#cleanCSS = cleanCSS
    }

    const { content: pcss } = await this.#postcss.process(content, { from: url }).async()
    const modulesJSON = this.getModulesJSON(url)
    const css = this.#isProd ? this.#cleanCSS.minify(pcss).styles : pcss

    if (url.startsWith('#inline-style-')) {
      return {
        code: css,
        map: undefined
      }
    }

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

async function initCleanCSS() {
  const { default: CleanCSS } = await import('https://esm.sh/clean-css@5.1.2?no-check')
  return new CleanCSS({ compatibility: '*' /* Internet Explorer 10+ */ })
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
  const url = `https://esm.sh/${name}?external=postcss@${postcssVersion}&no-check`
  const { default: Plugin } = await import(url)
  return Plugin
}
