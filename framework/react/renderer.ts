import type { ComponentType, ReactElement } from 'https://esm.sh/react'
import { createElement } from 'https://esm.sh/react'
import { renderToString } from 'https://esm.sh/react-dom/server'
import util from '../../shared/util.ts'
import type { RenderResult, RouterURL } from '../../types.ts'
import events from '../core/events.ts'
import { RendererContext, RouterContext } from './context.ts'
import { AsyncUseDenoError, E400MissingComponent, E404Page } from './error.ts'
import { createPageProps } from './pageprops.ts'
import { isLikelyReactComponent } from './util.ts'

export async function render(
  url: RouterURL,
  App: ComponentType<any> | undefined,
  E404: ComponentType | undefined,
  pageComponentChain: { url: string, Component?: any }[],
  styles: { url: string, hash: string }[]
) {
  const global = globalThis as any
  const ret: Omit<RenderResult, 'url' | 'status'> = {
    head: [],
    body: '',
    scripts: [],
    data: null,
  }
  const headElements = new Map()
  const scriptsElements = new Map()
  const buildMode = Deno.env.get('BUILD_MODE')
  const dataUrl = 'data://' + url.pathname
  const asyncCalls: Array<Promise<any>> = []
  const data: Record<string, any> = {}
  const pageProps = createPageProps(pageComponentChain)
  const defer = () => {
    delete global['rendering-' + dataUrl]
    events.removeAllListeners('useDeno-' + dataUrl)
  }

  // rendering data cache
  global['rendering-' + dataUrl] = {}

  // listen `useDeno-*` events to get hooks callback result.
  events.on('useDeno-' + dataUrl, (id: string, v: any) => {
    if (v instanceof Promise) {
      asyncCalls.push(v)
    } else {
      data[id] = v
    }
  })

  let el: ReactElement
  if (App) {
    if (isLikelyReactComponent(App)) {
      el = createElement(App, pageProps)
    } else {
      el = createElement(E400MissingComponent, { name: 'Custom App' })
    }
  } else {
    if (pageProps.Page == null) {
      if (E404) {
        if (isLikelyReactComponent(E404)) {
          el = createElement(E404)
        } else {
          el = createElement(E400MissingComponent, { name: 'Custom 404' })
        }
      } else {
        el = createElement(E404Page)
      }
    } else {
      el = createElement(pageProps.Page, pageProps.pageProps)
    }
  }

  // `renderToString` might be invoked repeatedly when asyncchronous callbacks exist.
  while (true) {
    try {
      if (asyncCalls.length > 0) {
        await Promise.all(asyncCalls.splice(0, asyncCalls.length))
      }
      ret.body = renderToString(createElement(
        RendererContext.Provider,
        { value: { headElements, scriptsElements } },
        createElement(
          RouterContext.Provider,
          { value: url },
          el
        )
      ))
      if (Object.keys(data).length > 0) {
        ret.data = data
      }
      break
    } catch (error) {
      if (error instanceof AsyncUseDenoError) {
        continue
      }

      defer()
      throw error
    }
  }

  // get head child tags
  headElements.forEach(({ type, props }) => {
    const { children, ...rest } = props
    if (type === 'title') {
      if (util.isNEString(children)) {
        ret.head.push(`<title ssr>${children}</title>`)
      } else if (util.isNEArray(children)) {
        ret.head.push(`<title ssr>${children.join('')}</title>`)
      }
    } else {
      const attrs = Object.entries(rest).map(([key, value]) => ` ${key}=${JSON.stringify(value)}`).join('')
      if (type === 'script') {
        ret.head.push(`<${type}${attrs}>${Array.isArray(children) ? children.join('') : children || ''}</${type}>`)
      } else if (util.isNEString(children)) {
        ret.head.push(`<${type}${attrs} ssr>${children}</${type}>`)
      } else if (util.isNEArray(children)) {
        ret.head.push(`<${type}${attrs} ssr>${children.join('')}</${type}>`)
      } else {
        ret.head.push(`<${type}${attrs} ssr />`)
      }
    }
  })
  headElements.clear()

  // get script tags
  scriptsElements.forEach(({ props }) => {
    const { children, dangerouslySetInnerHTML, ...attrs } = props
    if (dangerouslySetInnerHTML && util.isNEString(dangerouslySetInnerHTML.__html)) {
      ret.scripts.push({ ...attrs, innerText: dangerouslySetInnerHTML.__html })
    } if (util.isNEString(children)) {
      ret.scripts.push({ ...attrs, innerText: children })
    } else if (util.isNEArray(children)) {
      ret.scripts.push({ ...attrs, innerText: children.join('') })
    } else {
      ret.scripts.push(props)
    }
  })
  scriptsElements.clear()

  // apply styles
  await Promise.all(styles.map(async ({ url, hash }) => {
    if (!url.startsWith('#inline-style-')) {
      const pathname = util.isLikelyHttpURL(url) ? '/-/' + url.split('://')[1] : `${url}.${util.shortHash(hash)}`
      const importUrl = 'file://' + util.cleanPath(`${Deno.cwd()}/.aleph/${buildMode}/${pathname}.js`)
      const { default: applyCSS } = await import(importUrl)
      if (util.isFunction(applyCSS)) {
        const { css } = applyCSS()
        ret.head.push(`<style type="text/css" data-module-id=${JSON.stringify(url)} ssr>${css}</style>`)
      }
    }
  }))

  defer()
  return ret
}
