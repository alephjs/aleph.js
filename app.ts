import React, { ComponentType, createContext, useCallback, useEffect, useState } from 'https://esm.sh/react'
import { hydrate, render } from 'https://esm.sh/react-dom'
import { DataContext } from './data.ts'
import { E404Page, errAppEl, errPageEl } from './error.ts'
import events from './events.ts'
import route from './route.ts'
import { RouterContext } from './router.ts'
import type { AppManifest, RouterURL } from './types.ts'
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
        app?: { Component: ComponentType<any> }
        page: { Component: ComponentType<any> }
        pageModules: Record<string, { moduleId: string, hash: string }>
        url: RouterURL
    }
}) {
    const [manifest, setManifest] = useState(() => config.manifest)
    const [data, setData] = useState(() => config.data)
    const [app, setApp] = useState(() => ({
        Component: config.app ? (util.isLikelyReactComponent(config.app.Component) ? config.app.Component : () => errAppEl) : null
    }))
    const [pageModules, setPageModules] = useState(() => config.pageModules)
    const [page, setPage] = useState(() => ({
        url: config.url,
        Component: util.isLikelyReactComponent(config.page.Component) ? config.page.Component : () => errPageEl
    }))
    const onpopstate = useCallback(async () => {
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
            if (util.isLikelyReactComponent(Component)) {
                setPage({ url, Component })
            } else {
                setPage({
                    url,
                    Component: () => errPageEl
                })
            }
        } else {
            setPage({ url })
        }
    }, [manifest, pageModules])

    useEffect(() => {
        window.addEventListener('popstate', onpopstate)
        events.on('popstate', onpopstate)

        return () => {
            window.removeEventListener('popstate', onpopstate)
            events.off('popstate', onpopstate)
        }
    }, [onpopstate])

    useEffect(() => {
        const { baseUrl } = manifest
        const onUpdateData = (data: any) => {
            console.log('[DATA]', data)
            setData(data)
        }
        const onAddModule = async ({ moduleId, hash }: Module) => {
            if (moduleId === './app.js') {
                const { default: Component } = await import(getModuleImportUrl(baseUrl, { moduleId, hash }) + '?t=' + Date.now())
                if (util.isLikelyReactComponent(Component)) {
                    setApp({ Component })
                } else {
                    setPage({
                        Component: () => errAppEl
                    })
                }
            } else if (moduleId === './data.js' || moduleId === './data/index.js') {
                const { default: data } = await import(getModuleImportUrl(baseUrl, { moduleId, hash }) + '?t=' + Date.now())
                console.log('[DATA]', data)
                setData(data)
            } else if (moduleId.startsWith('./pages/')) {
                const pagePath = util.trimSuffix(moduleId, '.js').replace(/\s+/g, '-').replace(/\/?index$/i, '/')
                setPageModules(pageModules => ({
                    ...pageModules,
                    [pagePath]: { moduleId, hash }
                }))
            }
        }
        const onRemoveModule = (moduleId: string) => {
            if (moduleId === './app.js') {
                setApp({})
            } else if (moduleId === './data.js' || moduleId === './data/index.js') {
                console.log('[DATA]', {})
                setData({})
            } else if (moduleId.startsWith('./pages/')) {
                setPageModules(pageModules => {
                    const newPageModules: Record<string, { moduleId: string, hash: string }> = {}
                    for (const pagePath in pageModules) {
                        const mod = pageModules[pagePath]
                        if (mod.moduleId !== moduleId) {
                            newPageModules[pagePath] = mod
                        }
                    }
                    return newPageModules
                })
            }
        }

        events.on('update-data', onUpdateData)
        events.on('add-module', onAddModule)
        events.on('remove-module', onRemoveModule)

        return () => {
            events.off('update-data', onUpdateData)
            events.off('add-module', onAddModule)
            events.off('remove-module', onRemoveModule)
        }
    }, [manifest])

    const pageEl = React.createElement(page.Component)
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
    const mainEl = document.querySelector('main')
    const dataEl = document.getElementById('ssr-data')

    let url: RouterURL
    if (dataEl) {
        const data = JSON.parse(dataEl.innerHTML)
        if (data.url && util.isNEString(data.url.pagePath) && data.url.pagePath in pageModules) {
            url = data.url
        } else {
            throw new Error("invalid ssr-data")
        }
    } else {
        url = route(
            baseUrl,
            Object.keys(pageModules),
            {
                defaultLocale,
                locales: Object.keys(locales),
                fallback: '/404'
            }
        )
    }

    const pageModule = pageModules[url.pagePath]!
    const [
        { default: data },
        { default: AppComponent },
        { default: PageComponent }
    ] = await Promise.all([
        dataModule ? import(getModuleImportUrl(baseUrl, dataModule)) : Promise.resolve({ default: {} }),
        appModule ? import(getModuleImportUrl(baseUrl, appModule)) : Promise.resolve({}),
        pageModule ? import(getModuleImportUrl(baseUrl, pageModule)) : Promise.resolve({ default: E404Page }),
    ])
    const el = React.createElement(
        ALEPH,
        {
            config: {
                manifest: { baseUrl, defaultLocale, locales },
                data,
                app: appModule ? { Component: AppComponent } : undefined,
                page: {
                    Component: PageComponent
                },
                pageModules,
                url,
            }
        }
    )
    if (dataEl) {
        hydrate(el, mainEl)
        // remove ssr head elements, set a timmer to avoid tab title flash
        setTimeout(() => {
            Array.from(document.head.children).forEach((el: any) => {
                if (el.hasAttribute('ssr')) {
                    document.head.removeChild(el)
                }
            })
        }, 0)
    } else {
        render(el, mainEl)
    }
}

function getModuleImportUrl(baseUrl: string, { moduleId, hash }: Module) {
    return util.cleanPath(baseUrl + '/_aleph/' + moduleId.replace(/\.js$/, `.${hash.slice(0, hashShort)}.js`))
}
