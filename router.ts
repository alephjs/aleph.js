import React, { ComponentType, createContext, useContext } from 'https://esm.sh/react'
import events from './events.ts'
import type { RouterURL } from './types.ts'
import util from './util.ts'

export const RouterContext = createContext<RouterURL>({
    locale: 'en',
    pagePath: '/',
    pathname: '/',
    params: {},
    query: new URLSearchParams(),
})
RouterContext.displayName = 'RouterContext'

export function withRouter(Component: ComponentType<{ url: RouterURL }>) {
    function WithRouter(props: any) {
        const url = useRouter()
        return React.createElement(Component, Object.assign({}, props, { url }))
    }
    return WithRouter
}

export function useRouter() {
    return useContext(RouterContext)
}

export async function redirect(url: string, replace: boolean) {
    const { location, document, history } = window as any

    if (util.isHttpUrl(url)) {
        location.href = url
        return
    }

    url = util.cleanPath(url)
    if (location.protocol === 'file:') {
        const dataEl = document.getElementById('ssr-data')
        if (dataEl) {
            const ssrData = JSON.parse(dataEl.innerHTML)
            if (ssrData && 'url' in ssrData) {
                const { url: { pagePath: initialPagePath } } = ssrData
                location.href = location.href.replace(
                    `/${util.trimPrefix(initialPagePath, '/') || 'index'}.html`,
                    `/${util.trimPrefix(url, '/') || 'index'}.html`
                )
            }
        }
        return
    }

    if (replace) {
        history.replaceState(null, '', url)
    } else {
        history.pushState(null, '', url)
    }
    events.emit('popstate', { type: 'popstate' })
}