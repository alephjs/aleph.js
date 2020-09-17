import React, { ComponentType, createContext, useCallback, useEffect, useState } from 'https://esm.sh/react'
import { hydrate } from 'https://esm.sh/react-dom'
import type { AppManifest, RouterURL } from './api.ts'
import { DataContext } from './data.ts'
import { ErrorPage } from './error.ts'
import events from './events.ts'
import route from './route.ts'
import { RouterContext } from './router.ts'
import util, { hashShort } from './util.ts'

export const AppManifestContext = createContext<AppManifest>({
    baseUrl: '/',
    defaultLocale: 'en',
    locales: {},
})
AppManifestContext.displayName = 'AppManifestContext'

function ALEPH({ config }: {
    config: {
        manifest: AppManifest
        data: Record<string, any>
        app: { Component?: ComponentType<any> }
        page: { Component?: ComponentType<any> }
        pageModules: Record<string, { moduleId: string, hash: string }>
        url: RouterURL
    }
}) {
    const [manifest, setManifest] = useState(() => config.manifest)
    const [data, setData] = useState(() => ({ data: config.data }))
    const [app, setApp] = useState(() => ({
        Component: config.app.Component
    }))
    const [page, setPage] = useState(() => ({
        url: config.url,
        Component: config.page.Component
    }))
    const onpopstate = useCallback(async () => {
        const { pageModules } = config
        const { baseUrl, defaultLocale, locales } = manifest
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
            const mod = pageModules[url.pagePath]!
            const { default: Component } = await import(getModuleImportUrl(baseUrl, mod))
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
            DataContext.Provider,
            { value: data },
            React.createElement(
                RouterContext.Provider,
                { value: page.url },
                app.Component ? React.createElement(app.Component, null, pageEl) : pageEl
            )
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

interface Module {
    moduleId: string,
    hash: string,
}

export async function bootstrap({
    baseUrl,
    defaultLocale,
    locales,
    dataModule,
    appModule,
    pageModules
}: AppManifest & {
    dataModule: Module | null
    appModule: Module | null
    pageModules: Record<string, Module>
}) {
    const { document } = window as any
    const el = document.getElementById('ssr-data')

    if (el) {
        const { url } = JSON.parse(el.innerHTML)
        if (url && util.isNEString(url.pagePath) && url.pagePath in pageModules) {
            const pageModule = pageModules[url.pagePath]!
            const [
                data,
                { default: AppComponent },
                { default: PageComponent }
            ] = await Promise.all([
                dataModule ? import(getModuleImportUrl(baseUrl, dataModule)) : Promise.resolve({}),
                appModule ? import(getModuleImportUrl(baseUrl, appModule)) : Promise.resolve({}),
                import(getModuleImportUrl(baseUrl, pageModule)),
            ])
            const el = React.createElement(
                ALEPH,
                {
                    config: {
                        manifest: { baseUrl, defaultLocale, locales },
                        data,
                        app: { Component: AppComponent },
                        page: { Component: PageComponent },
                        pageModules,
                        url,
                    }
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

function getModuleImportUrl(baseUrl: string, { moduleId, hash }: Module) {
    return util.cleanPath(baseUrl + '/_dist/' + moduleId.replace(/\.js$/, `.${hash.slice(0, hashShort)}.js`))
}
