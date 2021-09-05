import { basename, dirname } from 'https://deno.land/std@0.106.0/path/mod.ts'
import log from '../shared/log.ts'
import util from '../shared/util.ts'
import type { HtmlDescriptor, Module, RouterURL, SSRData } from '../types.d.ts'
import type { Aleph } from './aleph.ts'

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
  #aleph: Aleph
  #renderer: FrameworkRenderer
  #cache: Map<string, Map<string, { html: string, data: Record<string, SSRData> | null }>>

  constructor(app: Aleph) {
    this.#aleph = app
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
    cache.set(key, { html, data })
    return [html, data]
  }

  clearCache(namespace?: string) {
    if (namespace) {
      Array.from(this.#cache.keys()).forEach(key => {
        if (key.startsWith(namespace)) {
          this.#cache.delete(key)
        }
      })
    } else {
      this.#cache.clear()
    }
  }

  /** render page base the given location. */
  async renderPage(url: RouterURL, nestedModules: string[]): Promise<[HtmlDescriptor, Record<string, SSRData> | null]> {
    const start = performance.now()
    const isDev = this.#aleph.isDev
    const state = { entryFile: '' }
    const appModule = this.#aleph.getModule('app')
    const { default: App } = appModule ? await this.#aleph.importModule(appModule) : {} as any
    const nestedPageComponents = await Promise.all(nestedModules
      .map(async specifier => {
        let module = this.#aleph.getModule(specifier)
        if (module === null) {
          module = await this.#aleph.compile(specifier)
        }
        const { default: Component, ssr } = await this.#aleph.importModule(module)
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

    const { head, body, data, scripts } = await this.#renderer.render(
      url,
      App,
      nestedPageComponents,
      styles
    )

    // keep working directory
    Deno.chdir(this.#aleph.workingDir)

    if (isDev) {
      log.info(`render '${url.toString()}' in ${Math.round(performance.now() - start)}ms`)
    }

    return [
      {
        lang: url.locale,
        headElements: head,
        scripts: [
          data ? {
            id: 'ssr-data',
            type: 'application/json',
            innerText: JSON.stringify(data, undefined, isDev ? 2 : 0),
          } : '',
          ...this.#aleph.getScripts(state.entryFile),
          ...scripts.map((script: Record<string, any>) => {
            if (script.innerText && !isDev) {
              return { ...script, innerText: script.innerText }
            }
            return script
          })
        ],
        body: `<div id="__aleph">${body}</div>`,
        bodyAttrs: {}
      },
      data
    ]
  }

  private async lookupStyleModules(...specifiers: string[]): Promise<Record<string, { css?: string, href?: string }>> {
    const mods: Module[] = []
    specifiers.forEach(specifier => {
      this.#aleph.lookupDeps(specifier, ({ specifier }) => {
        const mod = this.#aleph.getModule(specifier)
        if (mod && mod.isStyle) {
          mods.push({ ...mod, deps: [...mod.deps] })
        }
      })
    })
    return (await Promise.all(mods.map(async module => {
      const { css, href } = await this.#aleph.importModule(module)
      return { specifier: module.specifier, css, href }
    }))).reduce((styles, { specifier, css, href }) => {
      styles[specifier] = { css, href }
      return styles
    }, {} as Record<string, { css?: string, href?: string }>)
  }
}

/** build html content by given descriptor */
export function buildHtml({
  body,
  bodyAttrs = {},
  lang = 'en',
  headElements = [],
  scripts = []
}: HtmlDescriptor, minify = false) {
  const eol = minify ? '' : '\n'
  const indent = minify ? '' : ' '.repeat(2)
  const headTags = headElements.map(tag => tag.trim()).concat(scripts.map(v => {
    if (!util.isString(v) && util.isFilledString(v.src)) {
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
    } else if (util.isFilledString(v.innerText)) {
      const { innerText, ...rest } = v
      return `<script${formatAttrs(rest)}>${eol}${innerText}${eol}${indent}</script>`
    } else if (util.isFilledString(v.src) && !v.preload) {
      return `<script${formatAttrs(v)}></script>`
    } else {
      return ''
    }
  }).filter(Boolean)

  if (!headElements.some(tag => tag.trimLeft().startsWith('<meta') && tag.includes('name="viewport"'))) {
    headTags.unshift('<meta name="viewport" content="width=device-width" />')
  }

  return [
    '<!DOCTYPE html>',
    `<html lang="${lang}">`,
    '<head>',
    indent + '<meta charSet="utf-8" />',
    ...headTags.map(tag => indent + tag),
    '</head>',
    `<body${formatAttrs(bodyAttrs)}>`,
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
