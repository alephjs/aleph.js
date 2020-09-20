import React, { ComponentType } from 'https://esm.sh/react'
import { DataContext } from './data.ts'
import { E501 } from './error.ts'
import { RouterContext } from './router.ts'
import type { RouterURL } from './types.ts'
import util from './util.ts'
import ReactDomServer from './vendor/react-dom-server/server.js'
export { renderHead } from './head.ts'

export function renderPage(
    data: Record<string, any>,
    url: RouterURL,
    App: ComponentType<any> | undefined,
    Page: ComponentType<any>,
) {
    const pageEl = React.createElement(util.isLikelyReactComponent(Page) ? Page : E501.Page)
    const appEl = App ? (util.isLikelyReactComponent(App) ? React.createElement(App, null, pageEl) : React.createElement(E501.App)) : pageEl
    return ReactDomServer.renderToString(React.createElement(
        DataContext.Provider,
        { value: data },
        React.createElement(
            RouterContext.Provider,
            { value: url },
            appEl
        )
    ))
}
