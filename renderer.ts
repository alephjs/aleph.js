import React, { ComponentType, ReactElement } from 'https://esm.sh/react'
import { renderToString } from 'https://esm.sh/react-dom/server'
import { RendererContext, RouterContext } from './context.ts'
import { AsyncUseDenoError, E400MissingDefaultExportAsComponent, E404Page } from './error.ts'
import events from './events.ts'
import { serverStyles } from './head.ts'
import { createPageProps } from './routing.ts'
import type { RouterURL } from './types.ts'
import util, { hashShort, reHttp } from './util.ts'

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
    pageComponentTree: { id: string, Component?: any }[],
    styles?: { url: string, hash: string }[]
): Promise<RenderResult> {
    let el: ReactElement
    const pageProps = createPageProps(pageComponentTree)
    if (App) {
        if (util.isLikelyReactComponent(App)) {
            el = React.createElement(App, pageProps)
        } else {
            el = React.createElement(
                E400MissingDefaultExportAsComponent,
                { name: 'Custom App' }
            )
        }
    } else {
        if (pageProps.Page == null) {
            if (E404) {
                if (util.isLikelyReactComponent(E404)) {
                    el = React.createElement(E404)
                } else {
                    el = React.createElement(
                        E400MissingDefaultExportAsComponent,
                        { name: 'Custom 404' }
                    )
                }
            } else {
                el = React.createElement(E404Page)
            }
        } else {
            el = React.createElement(pageProps.Page, pageProps.pageProps)
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
    const { __createHTMLDocument } = (window as any)
    const buildMode = Deno.env.get('__buildMode')
    const buildTarget = Deno.env.get('__buildTarget')
    const data: Record<string, any> = {}
    const useDenEvent = `useDeno://${url.pathname + '?' + url.query.toString()}`
    const useDenoAsyncCalls: Array<Promise<any>> = []

    Object.assign(window, {
        [`__asyncData_${useDenEvent}`]: {},
        document: __createHTMLDocument(),
        location: {
            protocol: 'http:',
            host: 'localhost',
            hostname: 'localhost',
            port: '',
            href: 'https://localhost' + url.pathname + url.query.toString(),
            origin: 'https://localhost',
            pathname: url.pathname,
            search: url.query.toString(),
            hash: '',
            reload() { },
            replace() { },
            toString() { return this.href },
        }
    })

    events.on(useDenEvent, (id: string, ret: any, async: boolean) => {
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
                React.createElement(
                    RendererContext.Provider,
                    { value: { cache: rendererCache } },
                    React.createElement(
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
            Object.assign(window, { [`__asyncData_${useDenEvent}`]: null })
            throw error
        }
    }

    Object.assign(window, { [`__asyncData_${useDenEvent}`]: null })
    events.removeAllListeners(useDenEvent)
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

    await Promise.all(styles?.map(({ url, hash }) => {
        const path = reHttp.test(url) ? url.replace(reHttp, '/-/') : `${url}.${hash.slice(0, hashShort)}`
        return import('file://' + util.cleanPath(`${Deno.cwd()}/.aleph/${buildMode}.${buildTarget}/${path}.js`))
    }) || [])
    styles?.forEach(({ url }) => {
        if (serverStyles.has(url)) {
            const { css, asLink } = serverStyles.get(url)!
            if (asLink) {
                ret.head.push(`<link rel="stylesheet" href="${css}" data-module-id=${JSON.stringify(url)} />`)
            } else {
                ret.head.push(`<style type="text/css" data-module-id=${JSON.stringify(url)}>${css}</style>`)
            }
        }
    })

    return ret
}
