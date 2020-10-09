import React, { ComponentType } from 'https://esm.sh/react'
import { renderToString } from 'https://esm.sh/react-dom/server'
import { DataContext, RouterContext } from './context.ts'
import { E501App, ErrorBoundary } from './error.ts'
import type { PageProps, RouterURL } from './types.ts'
import util from './util.ts'

export { renderHead } from './head.ts'

export function renderPage(
    url: RouterURL,
    staticData: Record<string, any>,
    App: ComponentType<PageProps> | undefined,
    pageComponentTree: { id: string, Component?: any }[]
) {
    const pageProps: PageProps = {
        Page: pageComponentTree[0].Component || (() => null),
        pageProps: {}
    }
    pageComponentTree.slice(1).reduce((p, m) => {
        const c: PageProps = {
            Page: m.Component || (() => null),
            pageProps: {}
        }
        p.pageProps = c
        return c
    }, pageProps)
    const appEl = App ? (util.isLikelyReactComponent(App) ? React.createElement(App, pageProps) : React.createElement(E501App)) : React.createElement(pageProps.Page, pageProps.pageProps)
    return renderToString(
        React.createElement(
            ErrorBoundary,
            null,
            React.createElement(
                DataContext.Provider,
                { value: staticData },
                React.createElement(
                    RouterContext.Provider,
                    { value: url },
                    appEl
                )
            )
        )
    )
}
