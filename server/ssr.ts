import { createBlankRouterURL, RouteModule } from '../framework/core/routing.ts'
import log from '../shared/log.ts'
import util from '../shared/util.ts'
import type { RouterURL } from '../types.ts'
import type { Application } from './app.ts'
import { createHtml } from './helper.ts'

/** The framework render result of SSR. */
export type FrameworkRenderResult = {
  head: string[]
  body: string
  scripts: Record<string, any>[]
  data: Record<string, string> | null
}

/** The framework renderer for SSR. */
export type FrameworkRenderer = {
  render(
    url: RouterURL,
    AppComponent: any,
    nestedPageComponents: { url: string, Component?: any }[]
  ): Promise<FrameworkRenderResult>
}

/** The renderer class for aleph server. */
export class Renderer {
  #app: Application
  #renderer: FrameworkRenderer

  constructor(app: Application) {
    this.#app = app
    this.#renderer = { render: async () => { throw new Error("framework renderer is undefined") } }
  }

  setFrameworkRenderer(renderer: FrameworkRenderer) {
    this.#renderer = renderer
  }

  private getHTMLScripts() {
    const { baseUrl } = this.#app.config

    if (this.#app.isDev) {
      return [
        { src: util.cleanPath(`${baseUrl}/_aleph/main.js`), type: 'module' },
        { src: util.cleanPath(`${baseUrl}/_aleph/-/deno.land/x/aleph/nomodule.js`), nomodule: true },
      ]
    }

    return [
      { src: util.cleanPath(`${baseUrl}/_aleph/main.js`) },
    ]
  }

  /** render page base the given location. */
  async renderPage(url: RouterURL, nestedModules: RouteModule[]): Promise<[string, any]> {
    const start = performance.now()
    const isDev = this.#app.isDev
    const appModule = this.#app.findModuleByName('app')
    const { default: App } = appModule ? await import(`file://${appModule.jsFile}#${appModule.hash.slice(0, 6)}`) : {} as any
    const imports = nestedModules
      .filter(({ url }) => this.#app.getModule(url) !== null)
      .map(async ({ url }) => {
        const { jsFile, hash } = this.#app.getModule(url)!
        const { default: Component } = await import(`file://${jsFile}#${hash.slice(0, 6)}`)
        return {
          url,
          Component
        }
      })
    const { head, body, data, scripts } = await this.#renderer.render(
      url,
      App,
      await Promise.all(imports)
    )

    if (isDev) {
      log.info(`render '${url.pathname}' in ${Math.round(performance.now() - start)}ms`)
    }

    return [
      createHtml({
        lang: url.locale,
        head: head,
        scripts: [
          data ? {
            id: 'ssr-data',
            type: 'application/json',
            innerText: JSON.stringify(data, undefined, isDev ? 2 : 0),
          } : '',
          ...this.getHTMLScripts(),
          ...scripts.map((script: Record<string, any>) => {
            if (script.innerText && !this.#app.isDev) {
              return { ...script, innerText: script.innerText }
            }
            return script
          })
        ],
        body: `<div id="__aleph">${body}</div>`,
        minify: !isDev
      }),
      data
    ]
  }

  /** render custom 404 page. */
  async render404Page(url: RouterURL): Promise<string> {
    const appModule = this.#app.findModuleByName('app')
    const e404Module = this.#app.findModuleByName('404')
    const { default: App } = appModule ? await import(`file://${appModule.jsFile}#${appModule.hash.slice(0, 6)}`) : {} as any
    const { default: E404 } = e404Module ? await import(`file://${e404Module.jsFile}#${e404Module.hash.slice(0, 6)}`) : {} as any
    const { head, body, data, scripts } = await this.#renderer.render(
      url,
      App,
      e404Module ? [{ url: e404Module.url, Component: E404 }] : []
    )
    return createHtml({
      lang: url.locale,
      head,
      scripts: [
        data ? {
          id: 'ssr-data',
          type: 'application/json',
          innerText: JSON.stringify(data, undefined, this.#app.isDev ? 2 : 0),
        } : '',
        ...this.getHTMLScripts(),
        ...scripts.map((script: Record<string, any>) => {
          if (script.innerText && !this.#app.isDev) {
            return { ...script, innerText: script.innerText }
          }
          return script
        })
      ],
      body: `<div id="__aleph">${body}</div>`,
      minify: !this.#app.isDev
    })
  }

  /** render custom loading page for SPA mode. */
  async renderSPAIndexPage(): Promise<string> {
    const { baseUrl, defaultLocale } = this.#app.config
    const loadingModule = this.#app.findModuleByName('loading')

    if (loadingModule) {
      const { default: Loading } = await import(`file://${loadingModule.jsFile}#${loadingModule.hash.slice(0, 6)}`)
      const {
        head,
        body,
        scripts
      } = await this.#renderer.render(
        createBlankRouterURL(baseUrl, defaultLocale),
        undefined,
        [{ url: loadingModule.url, Component: Loading }]
      )
      return createHtml({
        lang: defaultLocale,
        head,
        scripts: [
          ...this.getHTMLScripts(),
          ...scripts.map((script: Record<string, any>) => {
            if (script.innerText && !this.#app.isDev) {
              return { ...script, innerText: script.innerText }
            }
            return script
          })
        ],
        body: `<div id="__aleph">${body}</div>`,
        minify: !this.#app.isDev
      })
    }

    return createHtml({
      lang: defaultLocale,
      head: [],
      scripts: this.getHTMLScripts(),
      body: '',
      minify: !this.#app.isDev
    })
  }
}
