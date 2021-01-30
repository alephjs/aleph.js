import type { ComponentType, ReactElement } from 'https://esm.sh/react'
import { createElement } from 'https://esm.sh/react'
import { renderToString } from 'https://esm.sh/react-dom/server'
import { hashShort } from '../../shared/constants.ts'
import util from '../../shared/util.ts'
import type { RenderResult, RouterURL } from '../../types.ts'
import events from '../core/events.ts'
import { RendererContext, RouterContext } from './context.ts'
import { AsyncUseDenoError, E400MissingComponent, E404Page } from './error.ts'
import { serverStyles } from './style.ts'
import { createPageProps, isLikelyReactComponent } from './util.ts'

export async function render(
    url: RouterURL,
    App: ComponentType<any> | undefined,
    E404: ComponentType | undefined,
    pageComponentTree: { url: string, Component?: any }[],
    styles?: { url: string, hash: string }[]
) {
    const global = globalThis as any
    const ret: Omit<RenderResult, 'url' | 'status'> = {
        head: [],
        body: '',
        scripts: [],
        data: null,
    }
    const renderStorage = {
        headElements: new Map(),
        scriptsElements: new Map()
    }
    const buildMode = Deno.env.get('BUILD_MODE')
    const dataUrl = 'data://' + url.pathname
    const asyncCalls: Array<Promise<any>> = []
    const data: Record<string, any> = {}
    const pageProps = createPageProps(pageComponentTree)
    const defer = () => {
        delete global['rendering-' + dataUrl]
        events.removeAllListeners('useDeno-' + dataUrl)
    }

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

    // `renderToString` might be invoked repeatedly when asyncchronous
    // callbacks of the `useDeno` hook exist.
    while (true) {
        try {
            if (asyncCalls.length > 0) {
                await Promise.all(asyncCalls.splice(0, asyncCalls.length))
            }
            ret.body = renderToString(createElement(
                RendererContext.Provider,
                { value: { storage: renderStorage } },
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
    renderStorage.headElements.forEach(({ type, props }) => {
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
    renderStorage.headElements.clear()

    // get script tags
    renderStorage.scriptsElements.forEach(({ props }) => {
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
    renderStorage.scriptsElements.clear()

    // get inline-styles
    const rets = await Promise.all(styles?.filter(({ url }) => !url.startsWith('#inline-style-')).map(({ url, hash }) => {
        const path = util.isLikelyURL(url) ? '/-/' + url.split('://')[1] : `${url}.${hash.slice(0, hashShort)}`
        return import('file://' + util.cleanPath(`${Deno.cwd()}/.aleph/${buildMode}/${path}.js`))
    }) || [])
    rets.forEach(({ default: def }) => util.isFunction(def) && def())
    styles?.forEach(({ url }) => {
        if (serverStyles.has(url)) {
            const css = serverStyles.get(url)!
            ret.head.push(`<style type="text/css" data-module-id=${JSON.stringify(url)} ssr>${css}</style>`)
        }
    })

    defer()
    return ret
}
