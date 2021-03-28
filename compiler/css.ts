import { Plugin, PluginCreator } from 'https://esm.sh/postcss@8.2.8'
import util from '../shared/util.ts'

const postcssVersion = '8.2.8'
const productionOnlyPostcssPlugins = ['autoprefixer']

export type PostCSSPlugin = string | [string, any] | Plugin | PluginCreator<any>

export class CSSProcessor {
  #isProd: boolean
  #postcssPlugins: PostCSSPlugin[]
  #postcss: any
  #cleanCSS: any

  constructor() {
    this.#isProd = false
    this.#postcssPlugins = []
    this.#postcss = null
    this.#cleanCSS = null
  }

  config(isProd: boolean, postcssPlugins: PostCSSPlugin[]) {
    this.#isProd = isProd
    this.#postcssPlugins = postcssPlugins
  }

  async transform(url: string, content: string): Promise<{ code: string, map?: string }> {
    if (util.isLikelyHttpURL(url)) {
      return {
        code: [
          `import { applyCSS } from "https://deno.land/x/aleph/framework/core/style.ts"`,
          `applyCSS(${JSON.stringify(url)})`
        ].join('\n')
      }
    }

    if (this.#postcss == null) {
      const [postcss, cleanCSS] = await Promise.all([
        initPostCSS(this.#postcssPlugins),
        this.#isProd ? initCleanCSS() : Promise.resolve(null)
      ])
      this.#postcss = postcss
      this.#cleanCSS = cleanCSS
    }

    const { content: pcss } = await this.#postcss.process(content).async()
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
        `applyCSS(${JSON.stringify(url)}, ${JSON.stringify(css)})`
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
  const isDev = Deno.env.get('BUILD_MODE') === 'development'
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
      return [Plugin, p[1]]
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
