import React, { ComponentType, ReactElement } from 'https://esm.sh/react'
import { renderToString } from 'https://esm.sh/react-dom/server'
import { RouterContext } from './context.ts'
import { AsyncUseDenoError, E400MissingDefaultExportAsComponent, E404Page } from './error.ts'
import events from './events.ts'
import { createPageProps } from './routing.ts'
import type { RouterURL } from './types.ts'
import util from './util.ts'

export { renderHead } from './head.ts'

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
