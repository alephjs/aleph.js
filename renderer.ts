import React, { ComponentType } from 'https://esm.sh/react'
import type { RouterURL } from './api.ts'
import { RouterContext } from './router.ts'
import ReactDomServer from './vendor/react-dom-server/server.js'
export { renderHead } from './head.ts'

export function renderPage(
    url: RouterURL,
    App: { Component: ComponentType, staticProps: any } | undefined,
    Page: { Component: ComponentType, staticProps: any },
) {
    const El = React.createElement(
        RouterContext.Provider,
        { value: url },
        React.createElement(
            Page.Component,
            Page.staticProps
        )
    )
    const html = ReactDomServer.renderToString(App ? React.createElement(App.Component, App.staticProps, El) : El)
    return html
}
