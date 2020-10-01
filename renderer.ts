import React, { ComponentType } from 'https://esm.sh/react'
import { renderToString } from 'https://esm.sh/react-dom/server'
import { DataContext } from './data.ts'
import { E501App, E501Page, ErrorBoundary } from './error.ts'
import { RouterContext } from './router.ts'
import type { RouterURL } from './types.ts'
import util from './util.ts'
export { renderHead } from './head.ts'

export function renderPage(
    data: Record<string, any>,
    url: RouterURL,
    App: ComponentType<any> | undefined,
    Page: ComponentType<any>,
) {
    const pageEl = React.createElement(util.isLikelyReactComponent(Page) ? Page : E501Page)
    const appEl = App ? (util.isLikelyReactComponent(App) ? React.createElement(App, null, pageEl) : React.createElement(E501App)) : pageEl
    return renderToString(
        React.createElement(
            ErrorBoundary,
            null,
            React.createElement(
                DataContext.Provider,
                { value: data },
                React.createElement(
                    RouterContext.Provider,
                    { value: url },
                    appEl
                )
            )
        )
    )
}
