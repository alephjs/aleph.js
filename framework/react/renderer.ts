import { createElement, ComponentType, ReactElement } from 'https://esm.sh/react@17.0.2'
import { renderToString } from 'https://esm.sh/react-dom@17.0.2/server'
import util from '../../shared/util.ts'
import type { FrameworkRenderResult } from '../../server/renderer.ts'
import type { RouterURL } from '../../types.d.ts'
import events from '../core/events.ts'
import { RouterContext, SSRContext } from './context.ts'
import { E400MissingComponent, E404Page } from './components/ErrorBoundary.ts'
import { AsyncUseDenoError } from './hooks.ts'
import { isLikelyReactComponent } from './helper.ts'
import { createPageProps } from './pageprops.ts'

export type RendererStore = {
  headElements: Map<string, { type: string, props: Record<string, any> }>
  inlineStyles: Map<string, string>
  scripts: Map<string, { props: Record<string, any> }>
}

export async function render(
  url: RouterURL,
  App: ComponentType<any> | undefined,
  nestedPageComponents: { specifier: string, Component?: any, props?: Record<string, any> }[],
  styles: Record<string, { css?: string, href?: string }>
): Promise<FrameworkRenderResult> {
  const global = window as any
  const ret: FrameworkRenderResult = {
    head: [],
    body: '',
    scripts: [],
    data: null,
  }
  const rendererStore: RendererStore = {
    headElements: new Map(),
    inlineStyles: new Map(),
    scripts: new Map(),
  }
  const dataUrl = 'pagedata://' + url.toString()
  const dataKey = 'rendering-' + dataUrl
  const asyncCalls: Array<[string, number, Promise<any>]> = []
  const data: Record<string, any> = {}
  const renderingData: Record<string, any> = {}
  const pageProps = createPageProps(nestedPageComponents)
  const defer = async () => {
    Reflect.deleteProperty(global, dataKey)
    events.removeAllListeners('useDeno-' + dataUrl)
  }

  nestedPageComponents.forEach(({ specifier, props }) => {
    if (util.isPlainObject(props)) {
      let expires = 0
      if (typeof props.$revalidate === 'number' && props.$revalidate > 0) {
        expires = Date.now() + Math.round(props.$revalidate * 1000)
      }
      data[`props-${btoa(specifier)}`] = {
        value: props,
        expires
      }
    }
  })

  // share rendering data
  global[dataKey] = renderingData

  // listen `useDeno-*` events to get hooks callback result.
  events.on('useDeno-' + dataUrl, ({ id, value, expires }: { id: string, value: any, expires: number }) => {
    if (value instanceof Promise) {
      asyncCalls.push([id, expires, value])
    } else {
      data[id] = { value, expires }
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
    if (asyncCalls.length > 0) {
      const calls = asyncCalls.splice(0, asyncCalls.length)
      const datas = await Promise.all(calls.map(a => a[2]))
      calls.forEach(([id, expires], i) => {
        const value = datas[i]
        renderingData[id] = value
        data[id] = { value, expires }
      })
    }
    try {
      Object.values(rendererStore).forEach(map => map.clear())
      ret.body = renderToString(createElement(
        SSRContext.Provider,
        { value: rendererStore },
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

  // insert head child tags
  rendererStore.headElements.forEach(({ type, props }) => {
    const { children, ...rest } = props
    if (type === 'title') {
      if (util.isFilledString(children)) {
        ret.head.push(`<title ssr>${children}</title>`)
      } else if (util.isFilledArray(children)) {
        ret.head.push(`<title ssr>${children.join('')}</title>`)
      }
    } else {
      const attrs = Object.entries(rest).map(([key, value]) => ` ${key}=${JSON.stringify(value)}`).join('')
      if (type === 'script') {
        ret.head.push(`<${type}${attrs}>${Array.isArray(children) ? children.join('') : children || ''}</${type}>`)
      } else if (util.isFilledString(children)) {
        ret.head.push(`<${type}${attrs} ssr>${children}</${type}>`)
      } else if (util.isFilledArray(children)) {
        ret.head.push(`<${type}${attrs} ssr>${children.join('')}</${type}>`)
      } else {
        ret.head.push(`<${type}${attrs} ssr />`)
      }
    }
  })

  // insert script tags
  rendererStore.scripts.forEach(({ props }) => {
    const { children, dangerouslySetInnerHTML, ...attrs } = props
    if (dangerouslySetInnerHTML && util.isFilledString(dangerouslySetInnerHTML.__html)) {
      ret.scripts.push({ ...attrs, innerText: dangerouslySetInnerHTML.__html })
    } if (util.isFilledString(children)) {
      ret.scripts.push({ ...attrs, innerText: children })
    } else if (util.isFilledArray(children)) {
      ret.scripts.push({ ...attrs, innerText: children.join('') })
    } else {
      ret.scripts.push(props)
    }
  })

  // insert styles
  Object.entries(styles).forEach(([url, { css, href }]) => {
    if (css) {
      ret.head.push(`<style type="text/css" data-module-id=${JSON.stringify(url)} ssr>${css}</style>`)
    } else if (href) {
      ret.head.push(`<link rel="stylesheet" href=${JSON.stringify(href)} data-module-id=${JSON.stringify(url)} ssr />`)
    }
  })
  for (const [url, css] of rendererStore.inlineStyles.entries()) {
    ret.head.push(`<style type="text/css" data-module-id=${JSON.stringify(url)} ssr>${css}</style>`)
  }

  defer()
  return ret
}
