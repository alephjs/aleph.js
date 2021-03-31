import { createElement, ComponentType, ReactElement } from 'https://esm.sh/react'
import { renderToString } from 'https://esm.sh/react-dom/server'
import util from '../../shared/util.ts'
import type { FrameworkRenderResult } from '../../server/renderer.ts'
import type { RouterURL } from '../../types.ts'
import events from '../core/events.ts'
import { serverStyles } from '../core/style.ts'
import { RouterContext, SSRContext } from './context.ts'
import { AsyncUseDenoError, E400MissingComponent, E404Page } from './error.ts'
import { isLikelyReactComponent } from './helper.ts'
import { createPageProps } from './pageprops.ts'

export type RendererStorage = {
  headElements: Map<string, { type: string, props: Record<string, any> }>
  scriptElements: Map<string, { props: Record<string, any> }>
}

export async function render(
  url: RouterURL,
  App: ComponentType<any> | undefined,
  nestedPageComponents: { url: string, Component?: any }[]
): Promise<FrameworkRenderResult> {
  const global = globalThis as any
  const ret: FrameworkRenderResult = {
    head: [],
    body: '',
    scripts: [],
    data: null,
  }
  const rendererStorage: RendererStorage = {
    headElements: new Map(),
    scriptElements: new Map(),
  }
  const pagedataUrl = 'pagedata://' + url.pathname
  const asyncCalls: Array<Promise<any>> = []
  const data: Record<string, any> = {}
  const pageProps = createPageProps(nestedPageComponents)
  const defer = () => {
    delete global['rendering-' + pagedataUrl]
    events.removeAllListeners('useDeno-' + pagedataUrl)
  }

  // rendering data cache
  global['rendering-' + pagedataUrl] = {}

  // listen `useDeno-*` events to get hooks callback result.
  events.on('useDeno-' + pagedataUrl, (id: string, v: any) => {
    if (v instanceof Promise) {
      asyncCalls.push(v)
    } else {
      data[id] = v
    }
  })

  let el: ReactElement
  if (App) {
    if (isLikelyReactComponent(App)) {
      if (pageProps.Page == null) {
        el = createElement(E404Page)
      } else {
        el = createElement(App, pageProps)
      }
    } else {
      el = createElement(E400MissingComponent, { name: 'Custom App' })
    }
  } else {
    if (pageProps.Page == null) {
      el = createElement(E404Page)
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
        SSRContext.Provider,
        { value: rendererStorage },
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
  rendererStorage.headElements.forEach(({ type, props }) => {
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

  // get script tags
  rendererStorage.scriptElements.forEach(({ props }) => {
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

  // get styles
  serverStyles.forEach((css, url) => {
    if (css) {
      ret.head.push(`<style type="text/css" data-module-id=${JSON.stringify(url)} ssr>${css}</style>`)
    } else if (util.isLikelyHttpURL(url)) {
      ret.head.push(`<link rel="stylesheet" href="${url}" data-module-id=${JSON.stringify(url)} ssr />`)
    }
  })

  defer()
  return ret
}
