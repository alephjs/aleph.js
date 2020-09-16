import React, { ComponentType, createContext, useCallback, useEffect, useState } from 'https://esm.sh/react'
import { hydrate } from 'https://esm.sh/react-dom'
import type { AppManifest, RouterURL } from './api.ts'
import { ErrorPage } from './error.ts'
import events from './events.ts'
import route from './route.ts'
import { RouterContext } from './router.ts'
import util, { hashShort } from './util.ts'

export const AppManifestContext = createContext<AppManifest>({
    baseUrl: '/',
    defaultLocale: 'en',
    locales: {},
    appModule: null,
    pageModules: {},
})
AppManifestContext.displayName = 'AppManifestContext'

function Main({
    manifest: initialManifest,
    url: initialUrl,
    app: initialApp,
    page: initialPage
}: {
    manifest: AppManifest
    url: RouterURL
    app: { Component?: ComponentType<any> }
    page: { Component?: ComponentType<any> }
}) {
    const [manifest, setManifest] = useState(() => initialManifest)
    const [app, setApp] = useState(() => ({
        Component: initialApp.Component
    }))
    const [page, setPage] = useState(() => ({
        url: initialUrl,
        Component: initialPage.Component
    }))
    const onpopstate = useCallback(async () => {
        const { baseUrl, pageModules, defaultLocale, locales } = manifest
        const url = route(
            baseUrl,
            Object.keys(pageModules),
            {
                defaultLocale,
                locales: Object.keys(locales),
                fallback: '/404'
            }
        )
        if (url.pagePath in pageModules) {
            const { moduleId, hash } = pageModules[url.pagePath]!
            const importPath = util.cleanPath(baseUrl + '/_dist/' + moduleId.replace(/\.js$/, `.${hash.slice(0, hashShort)}.js`))
            const { default: Component } = await import(importPath)
            setPage({ url, Component })
        } else {
            setPage({ url })
        }
    }, [manifest])

    useEffect(() => {
        window.addEventListener('popstate', onpopstate)
        events.on('popstate', onpopstate)

        return () => {
            window.removeEventListener('popstate', onpopstate)
            events.off('popstate', onpopstate)
        }
    }, [onpopstate])

    const pageEl = page.Component ? React.createElement(page.Component, page.props) : React.createElement(ErrorPage, { status: 404 })
    return React.createElement(
        AppManifestContext.Provider,
        { value: manifest },
        React.createElement(
            RouterContext.Provider,
            { value: page.url },
            app.Component ? React.createElement(app.Component, null, pageEl) : pageEl
        )
    )
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

export async function bootstrap(manifest: AppManifest) {
    const { document } = window as any
    const { baseUrl, appModule, pageModules } = manifest
    const el = document.getElementById('ssr-data')

    if (el) {
        const { url } = JSON.parse(el.innerHTML)
        if (url && util.isNEString(url.pagePath) && url.pagePath in pageModules) {
            const pageModule = pageModules[url.pagePath]!
            const [
                { default: AppComponent },
                { default: PageComponent }
            ] = await Promise.all([
                appModule ? import(baseUrl + `_dist/app.${appModule.hash.slice(0, hashShort)}.js`) : Promise.resolve({}),
                import(baseUrl + '_dist/' + pageModule.moduleId.replace(/\.js$/, `.${pageModule.hash.slice(0, hashShort)}.js`)),
            ])
            const el = React.createElement(
                Main,
                {
                    url,
                    manifest,
                    app: { Component: AppComponent },
                    page: { Component: PageComponent },
                }
            )
            Array.from(document.head.children).forEach((el: any) => {
                if (el.hasAttribute('ssr')) {
                    document.head.removeChild(el)
                }
            })
            hydrate(el, document.querySelector('main'))
        }
    }
}
