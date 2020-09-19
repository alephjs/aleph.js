import React, { ComponentType } from 'https://esm.sh/react'
import { DataContext } from './data.ts'
import { errAppEl, errPageEl } from './error.ts'
import { RouterContext } from './router.ts'
import type { RouterURL } from './types.ts'
import util from './util.ts'
import ReactDomServer from './vendor/react-dom-server/server.js'
export { renderHead } from './head.ts'

export function renderPage(
    data: Record<string, any>,
    url: RouterURL,
    App: { Component: ComponentType<any> } | undefined,
    Page: { Component: ComponentType<any> },
) {
    const pageEl = util.isLikelyReactComponent(Page.Component) ? React.createElement(Page.Component) : errPageEl
    const appEl = App ? (util.isLikelyReactComponent(App.Component) ? React.createElement(App.Component, null, pageEl) : errAppEl) : pageEl
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
