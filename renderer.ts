import React, { ComponentType } from 'https://esm.sh/react'
import { renderToString } from 'https://esm.sh/react-dom/server'
import { DataContext, RouterContext } from './context.ts'
import { E501App, E501Page, ErrorBoundary } from './error.ts'
import type { RouterURL } from './types.ts'
import util from './util.ts'

export { renderHead } from './head.ts'

export function renderPage(
    url: RouterURL,
    data: Record<string, any>,
    App: ComponentType<any> | undefined,
    Page: ComponentType<any>,
) {
    if (!util.isLikelyReactComponent(Page)) {
        Page = E501Page
    }
    const appEl = App ? (util.isLikelyReactComponent(App) ? React.createElement(App, { Page }) : React.createElement(E501App)) : React.createElement(Page)
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
