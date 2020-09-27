import React, { ComponentType, createContext, useCallback, useEffect, useState } from 'https://esm.sh/react'
import { hydrate, render } from 'https://esm.sh/react-dom'
import { DataContext } from './data.ts'
import { E404Page, E501 } from './error.ts'
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

function ALEPH({ initial }: {
    initial: {
        manifest: AppManifest
        pageModules: Record<string, { moduleId: string, hash: string }>
        url: RouterURL
        data: Record<string, any>
        components: Record<string, ComponentType<any>>
    }
}) {
    const [manifest, setManifest] = useState(() => initial.manifest)
    const [data, setData] = useState(() => initial.data)
    const [pageModules, setPageModules] = useState(() => initial.pageModules)
    const [e404, setE404] = useState(() => {
        const { E404 } = initial.components
        return {
            Component: E404 && util.isLikelyReactComponent(E404) ? E404 : E404Page
        }
    })
    const [app, setApp] = useState(() => {
        const { App } = initial.components
        return {
            Component: App ? (util.isLikelyReactComponent(App) ? App : E501.App) : null
        }
    })
    const [page, setPage] = useState(() => {
        const { components, url } = initial
        const { Page } = components
        return {
            url,
            Component: Page ? (util.isLikelyReactComponent(Page) ? Page : E501.Page) : null
        }
    })
    const onpopstate = useCallback(async () => {
        const { baseUrl, defaultLocale, locales } = manifest
        const url = route(
            baseUrl,
            Object.keys(pageModules),
            {
                defaultLocale,
                locales: Object.keys(locales)
            }
        )
        if (url.pagePath && url.pagePath in pageModules) {
            const mod = pageModules[url.pagePath]!
            const { default: Component } = await import(getModuleImportUrl(baseUrl, mod))
            if (util.isLikelyReactComponent(Component)) {
                setPage({ url, Component })
            } else {
                setPage({
                    url,
                    Component: E501.Page
                })
            }
        } else {
            setPage({ url, Component: null })
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
            if (moduleId === './404.js') {
                const { default: Component } = await import(getModuleImportUrl(baseUrl, { moduleId, hash }) + '?t=' + Date.now())
                if (util.isLikelyReactComponent(Component)) {
                    setE404({ Component })
                } else {
                    setE404({ Component: E404Page })
                }
            } else if (moduleId === './app.js') {
                const { default: Component } = await import(getModuleImportUrl(baseUrl, { moduleId, hash }) + '?t=' + Date.now())
                if (util.isLikelyReactComponent(Component)) {
                    setApp({ Component })
                } else {
                    setPage(({ url }) => ({
                        url,
                        Component: E501.App
                    }))
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
            if (moduleId === './404.js') {
                setE404({ Component: E404Page })
            } else if (moduleId === './app.js') {
                setApp({ Component: null })
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

    const pageEl = React.createElement(page.Component || e404.Component)
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
    keyModules,
    pageModules
}: AppManifest & {
    keyModules: Record<string, Module>
    pageModules: Record<string, Module>
}) {
    const { document } = window as any
    const mainEl = document.querySelector('main')
    const dataEl = document.getElementById('ssr-data')

    let url: RouterURL
    if (dataEl) {
        const data = JSON.parse(dataEl.innerHTML)
        if (util.isPlainObject(data.url)) {
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
                locales: Object.keys(locales)
            }
        )
    }

    const pageModule = pageModules[url.pagePath]!
    const [
        { default: data },
        { default: App },
        { default: E404 },
        { default: Page }
    ] = await Promise.all([
        keyModules.data ? import(getModuleImportUrl(baseUrl, keyModules.data)) : Promise.resolve({ default: {} }),
        keyModules.app ? import(getModuleImportUrl(baseUrl, keyModules.app)) : Promise.resolve({}),
        keyModules['404'] ? import(getModuleImportUrl(baseUrl, keyModules['404'])) : Promise.resolve({}),
        pageModule ? import(getModuleImportUrl(baseUrl, pageModule)) : Promise.resolve({}),
    ])
    const el = React.createElement(
        ALEPH,
        {
            initial: {
                manifest: { baseUrl, defaultLocale, locales },
                pageModules,
                url,
                data,
                components: { E404, App, Page }
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
