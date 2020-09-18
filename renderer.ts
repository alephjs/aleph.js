import React, { ComponentType } from 'https://esm.sh/react'
import type { RouterURL } from './api.ts'
import { DataContext } from './data.ts'
import { RouterContext } from './router.ts'
import ReactDomServer from './vendor/react-dom-server/server.js'
export { renderHead } from './head.ts'

export function renderPage(
    data: Record<string, any>,
    url: RouterURL,
    App: { Component: ComponentType<any> } | undefined,
    Page: { Component: ComponentType<any> },
) {
    const el = App ? React.createElement(App.Component, null, React.createElement(Page.Component)) : React.createElement(Page.Component)
    return ReactDomServer.renderToString(React.createElement(
        DataContext.Provider,
        { value: data },
        React.createElement(
            RouterContext.Provider,
            { value: url },
            el
        )
    ))
}
