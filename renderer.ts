import React, { ComponentType, ReactElement } from 'https://esm.sh/react'
import { renderToString } from 'https://esm.sh/react-dom/server'
import { RouterContext } from './context.ts'
import { AsyncUseDenoError, E400MissingDefaultExportAsComponent, E404Page } from './error.ts'
import events from './events.ts'
import { serverHeadElements, serverScriptsElements, serverStyles } from './head.ts'
import { createPageProps } from './routing.ts'
import type { AlephEnv, RouterURL } from './types.ts'
import util, { hashShort } from './util.ts'

export async function renderHead(styles?: { url: string, hash: string, async?: boolean }[]) {
    const { __buildMode, __buildTarget } = (window as any).ALEPH.ENV as AlephEnv
    const tags: string[] = []
    serverHeadElements.forEach(({ type, props }) => {
        if (type === 'title') {
            if (util.isNEString(props.children)) {
                tags.push(`<title ssr>${props.children}</title>`)
            } else if (util.isNEArray(props.children)) {
                tags.push(`<title ssr>${props.children.join('')}</title>`)
            }
        } else {
            const attrs = Object.keys(props)
                .filter(key => key !== 'children')
                .map(key => ` ${key}=${JSON.stringify(props[key])}`)
                .join('')
            if (util.isNEString(props.children)) {
                tags.push(`<${type}${attrs} ssr>${props.children}</${type}>`)
            } else if (util.isNEArray(props.children)) {
                tags.push(`<${type}${attrs} ssr>${props.children.join('')}</${type}>`)
            } else {
                tags.push(`<${type}${attrs} ssr />`)
            }
        }
    })
    await Promise.all(styles?.filter(({ async }) => !!async).map(({ url, hash }) => {
        return import('file://' + util.cleanPath(`${Deno.cwd()}/.aleph/${__buildMode}.${__buildTarget}/${url}.${hash.slice(0, hashShort)}.js`))
    }) || [])
    styles?.forEach(({ url }) => {
        if (serverStyles.has(url)) {
            const { css, asLink } = serverStyles.get(url)!
            if (asLink) {
                tags.push(`<link rel="stylesheet" href="${css}" data-module-id=${JSON.stringify(url)} />`)
            } else {
                tags.push(`<style type="text/css" data-module-id=${JSON.stringify(url)}>${css}</style>`)
            }
        }
    })
    serverHeadElements.clear()
    return tags
}

export function renderScripts() {
    const scripts: Record<string, any>[] = []
    serverScriptsElements.forEach(({ props }) => {
        const { children, dangerouslySetInnerHTML, ...attrs } = props
        if (dangerouslySetInnerHTML && util.isNEString(dangerouslySetInnerHTML.__html)) {
            scripts.push({ ...attrs, innerText: dangerouslySetInnerHTML.__html })
        } if (util.isNEString(children)) {
            scripts.push({ ...attrs, innerText: unescape(children) })
        } else if (util.isNEArray(children)) {
            scripts.push({ ...attrs, innerText: unescape(children.join('')) })
        } else {
            scripts.push(props)
        }
    })
    serverScriptsElements.clear()
    return scripts
}

export async function renderPage(
    url: RouterURL,
    App: ComponentType<any> | undefined,
    E404: ComponentType | undefined,
    pageComponentTree: { id: string, Component?: any }[]
) {
    let el: ReactElement
    let html: string
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
    const data: Record<string, any> = {}
    const useDenEvent = `useDeno://${url.pathname + '?' + url.query.toString()}`
    const useDenoAsyncCalls: Array<Promise<any>> = []
    events.on(useDenEvent, (id: string, ret: any, async: boolean) => {
        if (async) {
            useDenoAsyncCalls.push(ret)
        } else {
            data[id] = ret
        }
    })
    Object.assign(window, { [`__asyncData_${useDenEvent}`]: {} })
    while (true) {
        try {
            if (useDenoAsyncCalls.length > 0) {
                const iter = [...useDenoAsyncCalls]
                useDenoAsyncCalls.splice(0, useDenoAsyncCalls.length)
                await Promise.all(iter)
            }
            html = renderToString(
                React.createElement(
                    RouterContext.Provider,
                    { value: url },
                    el
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
    return [html, Object.keys(data).length > 0 ? data : null]
}
