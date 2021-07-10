import { basename, dirname } from 'https://deno.land/std@0.100.0/path/mod.ts'
import log from '../shared/log.ts'
import util from '../shared/util.ts'
import type { RouterURL } from '../types.ts'
import type { Application, Module } from './app.ts'

export type SSRData = {
  value: any
  expires: number
}

export type SSROutput = {
  html: string
  data: Record<string, SSRData> | null
}

/** The render result of framework SSR. */
export type FrameworkRenderResult = {
  head: string[]
  body: string
  scripts: Record<string, any>[]
  data: Record<string, SSRData> | null
}

/** The renderer of framework SSR. */
export type FrameworkRenderer = {
  render(
    url: RouterURL,
    AppComponent: any,
    nestedPageComponents: { specifier: string, Component?: any, props?: Record<string, any> }[],
    styles: Record<string, { css?: string, href?: string }>
  ): Promise<FrameworkRenderResult>
}

/** The renderer class for SSR. */
export class Renderer {
  #app: Application
  #renderer: FrameworkRenderer
  #cache: Map<string, Map<string, SSROutput>>

  constructor(app: Application) {
    this.#app = app
    this.#renderer = { render: async () => { throw new Error("framework renderer is undefined") } }
    this.#cache = new Map()
  }

  setFrameworkRenderer(renderer: FrameworkRenderer) {
    this.#renderer = renderer
  }

  async cache(
    namespace: string,
    key: string,
    render: () => Promise<[string, Record<string, SSRData> | null]>
  ): Promise<[string, any]> {
    let cache = this.#cache.get(namespace)
    if (cache === undefined) {
      cache = new Map()
      this.#cache.set(namespace, cache)
    }
    if (cache.has(key)) {
      const { html, data } = cache.get(key)!
      let expires = 0
      if (data !== null) {
        Object.values(data).forEach(({ expires: _expires }) => {
          if (expires === 0 || (_expires > 0 && _expires < expires)) {
            expires = _expires
          }
        })
      }
      if (expires === 0 || Date.now() < expires) {
        return [html, data]
      }
      cache.delete(key)
    }
    let [html, data] = await render()
    if (namespace !== '-') {
      this.#app.getCodeInjects('ssr', key)?.forEach(transform => {
        const ret = transform(key, html)
        html = ret.code
      })
    }
    cache.set(key, { html, data })
    return [html, data]
  }

  clearCache(namespace?: string) {
    if (namespace) {
      Array.from(this.#cache.keys()).forEach(key => {
        if (key.startsWith(namespace)) {
          this.#cache.delete(namespace)
        }
      })
    } else {
      this.#cache.clear()
    }
  }

  /** render page base the given location. */
  async renderPage(url: RouterURL, nestedModules: string[]): Promise<[string, Record<string, SSRData> | null]> {
    const start = performance.now()
    const isDev = this.#app.isDev
    const state = { entryFile: '' }
    const appModule = this.#app.getModule('app')
    const { default: App } = appModule ? await this.#app.importModule(appModule) : {} as any
    const nestedPageComponents = await Promise.all(nestedModules
      .filter(specifier => this.#app.getModule(specifier) !== null)
      .map(async specifier => {
        const module = this.#app.getModule(specifier)!
        const { default: Component, ssr } = await this.#app.importModule(module)
        let ssrProps = ssr?.props
        if (util.isFunction(ssrProps)) {
          ssrProps = ssrProps(url)
          if (ssrProps instanceof Promise) {
            ssrProps = await ssrProps
          }
        }
        state.entryFile = dirname(specifier) + '/' + basename(module.jsFile)
        return {
          specifier,
          Component,
          props: util.isPlainObject(ssrProps) ? ssrProps : undefined
        }
      })
    )
    const styles = await this.lookupStyleModules(...[
      appModule ? appModule.specifier : [],
      nestedModules
    ].flat())

    // ensure working directory
    Deno.chdir(this.#app.workingDir)

    const { head, body, data, scripts } = await this.#renderer.render(
      url,
      App,
      nestedPageComponents,
      styles
    )

    if (isDev) {
      log.info(`render '${url.toString()}' in ${Math.round(performance.now() - start)}ms`)
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
          ...this.#app.getSSRHTMLScripts(state.entryFile),
          ...scripts.map((script: Record<string, any>) => {
            if (script.innerText && !isDev) {
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

  /** render the index page for SPA mode. */
  async renderSPAIndexPage(): Promise<string> {
    // todo: render custom fallback page
    return createHtml({
      lang: this.#app.config.defaultLocale,
      head: [],
      scripts: this.#app.getSSRHTMLScripts(),
      body: '<div id="__aleph"></div>',
      minify: !this.#app.isDev
    })
  }

  private async lookupStyleModules(...specifiers: string[]): Promise<Record<string, { css?: string, href?: string }>> {
    const mods: Module[] = []
    specifiers.forEach(specifier => {
      this.#app.lookupDeps(specifier, ({ specifier }) => {
        const mod = this.#app.getModule(specifier)
        if (mod && mod.isStyle) {
          mods.push({ ...mod, deps: [...mod.deps] })
        }
      })
    })
    return (await Promise.all(mods.map(async module => {
      const { css, href } = await this.#app.importModule(module)
      return { specifier: module.specifier, css, href }
    }))).reduce((styles, { specifier, css, href }) => {
      styles[specifier] = { css, href }
      return styles
    }, {} as Record<string, { css?: string, href?: string }>)
  }
}

/** create html content by given arguments */
function createHtml({
  body,
  lang = 'en',
  head = [],
  className,
  scripts = [],
  minify = false
}: {
  body: string,
  lang?: string,
  head?: string[],
  className?: string,
  scripts?: (string | { id?: string, type?: string, src?: string, innerText?: string, async?: boolean, preload?: boolean, nomodule?: boolean })[],
  minify?: boolean
}) {
  const eol = minify ? '' : '\n'
  const indent = minify ? '' : ' '.repeat(2)
  const headTags = head.map(tag => tag.trim()).concat(scripts.map(v => {
    if (!util.isString(v) && util.isNEString(v.src)) {
      if (v.type === 'module') {
        return `<link rel="modulepreload" href=${JSON.stringify(v.src)} />`
      } else if (!v.nomodule) {
        return `<link rel="preload" href=${JSON.stringify(v.src)} as="script" />`
      }
    }
    return ''
  })).filter(Boolean)
  const scriptTags = scripts.map(v => {
    if (util.isString(v)) {
      return `<script>${v}</script>`
    } else if (util.isNEString(v.innerText)) {
      const { innerText, ...rest } = v
      return `<script${formatAttrs(rest)}>${eol}${innerText}${eol}${indent}</script>`
    } else if (util.isNEString(v.src) && !v.preload) {
      return `<script${formatAttrs(v)}></script>`
    } else {
      return ''
    }
  }).filter(Boolean)

  if (!head.some(tag => tag.trimLeft().startsWith('<meta') && tag.includes('name="viewport"'))) {
    headTags.unshift('<meta name="viewport" content="width=device-width" />')
  }

  return [
    '<!DOCTYPE html>',
    `<html lang="${lang}">`,
    '<head>',
    indent + '<meta charSet="utf-8" />',
    ...headTags.map(tag => indent + tag),
    '</head>',
    className ? `<body class="${className}">` : '<body>',
    indent + body,
    ...scriptTags.map(tag => indent + tag),
    '</body>',
    '</html>'
  ].join(eol)
}

function formatAttrs(v: any): string {
  return Object.keys(v).filter(k => !!v[k]).map(k => {
    if (v[k] === true) {
      return ` ${k}`
    } else {
      return ` ${k}=${JSON.stringify(String(v[k]))}`
    }
  }).join('')
}
