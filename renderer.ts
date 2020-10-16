import React, { ComponentType, ReactElement } from 'https://esm.sh/react'
import { renderToString } from 'https://esm.sh/react-dom/server'
import { DataContext, RouterContext } from './context.ts'
import { E400MissingDefaultExportAsComponent, E404Page, ErrorBoundary } from './error.ts'
import { createPageProps } from './router.ts'
import type { RouterURL } from './types.ts'
import util from './util.ts'

export { renderHead } from './head.ts'

export function renderPage(
    url: RouterURL,
    staticData: Record<string, any>,
    App: ComponentType<any> | undefined,
    E404: ComponentType | undefined,
    pageComponentTree: { id: string, Component?: any }[]
) {
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
                    el
                )
            )
        )
    )
}
