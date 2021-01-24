import type { ComponentType, ReactElement } from 'https://esm.sh/react'
import { createElement } from 'https://esm.sh/react'
import { renderToString } from 'https://esm.sh/react-dom/server'
import { hashShort, reHttp } from '../../shared/constants.ts'
import util from '../../shared/util.ts'
import type { RouterURL } from '../../types.ts'
import events from '../core/events.ts'
import { RendererContext, RouterContext } from './context.ts'
import { AsyncUseDenoError, E400MissingComponent, E404Page } from './error.ts'
import { serverStyles } from './style.ts'
import { createPageProps, isLikelyReactComponent } from './util.ts'

interface RenderResult {
    head: string[]
    body: string
    data: Record<string, any> | null
    scripts: Record<string, any>[]
}

export async function renderPage(
    url: RouterURL,
    App: ComponentType<any> | undefined,
    E404: ComponentType | undefined,
    pageComponentTree: { url: string, Component?: any }[],
    styles?: { url: string, hash: string }[]
): Promise<RenderResult> {
    let el: ReactElement
    const pageProps = createPageProps(pageComponentTree)
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

    const ret: RenderResult = {
        head: [],
        body: '',
        data: null,
        scripts: []
    }
    const rendererCache = {
        headElements: new Map(),
        scriptsElements: new Map()
    }
    const data: Record<string, any> = {}
    const useDenUrl = `useDeno://${url.pathname}`
    const useDenoAsyncCalls: Array<Promise<any>> = []

    Object.assign(globalThis, {
        [`__asyncData_${useDenUrl}`]: {},
    })

    events.on(useDenUrl, (id: string, ret: any, async: boolean) => {
        if (async) {
            useDenoAsyncCalls.push(ret)
        } else {
            data[id] = ret
        }
    })

    while (true) {
        try {
            if (useDenoAsyncCalls.length > 0) {
                const iter = [...useDenoAsyncCalls]
                useDenoAsyncCalls.splice(0, useDenoAsyncCalls.length)
                await Promise.all(iter)
            }
            ret.body = renderToString(
                createElement(
                    RendererContext.Provider,
                    { value: { cache: rendererCache } },
                    createElement(
                        RouterContext.Provider,
                        { value: url },
                        el
                    )
                )
            )
            break
        } catch (error) {
            if (error instanceof AsyncUseDenoError) {
                continue
            }
            console.log(error)
            Object.assign(window, { [`__asyncData_${useDenUrl}`]: null })
            throw error
        }
    }

    Object.assign(window, { [`__asyncData_${useDenUrl}`]: null })
    events.removeAllListeners(useDenUrl)
    if (Object.keys(data).length > 0) {
        ret.data = data
    }

    rendererCache.headElements.forEach(({ type, props }) => {
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
    rendererCache.scriptsElements.forEach(({ props }) => {
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
    rendererCache.headElements.clear()
    rendererCache.scriptsElements.clear()

    const rets = await Promise.all(styles?.filter(({ url }) => !url.startsWith("#inline-style-")).map(({ url, hash }) => {
        const path = reHttp.test(url) ? url.replace(reHttp, '/-/') : `${url}.${hash.slice(0, hashShort)}`
        return import('file://' + util.cleanPath(`${Deno.cwd()}/.aleph/${path}.js`))
    }) || [])
    rets.forEach(({ default: def }) => util.isFunction(def) && def())
    styles?.forEach(({ url }) => {
        if (serverStyles.has(url)) {
            const { css, asLink } = serverStyles.get(url)!
            if (asLink) {
                ret.head.push(`<link rel="stylesheet" href="${css}" data-module-id=${JSON.stringify(url)} ssr />`)
            } else {
                ret.head.push(`<style type="text/css" data-module-id=${JSON.stringify(url)} ssr>${css}</style>`)
            }
        }
    })

    return ret
}
