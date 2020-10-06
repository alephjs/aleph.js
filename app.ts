import React, { ComponentType, useCallback, useEffect, useState } from 'https://esm.sh/react'
import { DataContext, RouterContext } from './context.ts'
import { E404Page, E501App, E501Page, ErrorBoundary } from './error.ts'
import events from './events.ts'
import { createRouter } from './router.ts'
import type { Module, RouterURL } from './types.ts'
import util, { hashShort, reModuleExt } from './util.ts'

export function ALEPH({ initial }: {
    initial: {
        baseUrl: string
        defaultLocale: string
        locales: string[]
        routing: Record<string, Module>
        url: RouterURL
        staticData: Record<string, any>
        components: Record<string, ComponentType<any>>
    }
}) {
    const [staticData, setStaticData] = useState(() => initial.staticData)
    const [routing, setRouting] = useState(() => initial.routing)
    const [locales, setLocales] = useState(() => initial.locales)
    const [e404, setE404] = useState(() => {
        const { E404 } = initial.components
        return {
            Component: E404 && util.isLikelyReactComponent(E404) ? E404 : E404Page
        }
    })
    const [app, setApp] = useState(() => {
        const { App } = initial.components
        return {
            Component: App ? (util.isLikelyReactComponent(App) ? App : E501App) : null
        }
    })
    const [page, setPage] = useState(() => {
        const { components, url } = initial
        const { Page } = components
        return {
            url,
            Component: Page ? (util.isLikelyReactComponent(Page) ? Page : E501Page) : null
        }
    })
    const onpopstate = useCallback(async () => {
        const { baseUrl, defaultLocale } = initial
        const url = createRouter(
            baseUrl,
            Object.keys(routing),
            {
                defaultLocale,
                locales
            }
        )
        if (url.pagePath && url.pagePath in routing) {
            const mod = routing[url.pagePath]!
            const { default: Component } = await import(getModuleImportUrl(baseUrl, mod))
            await Promise.all(mod.asyncDeps?.map(dep => {
                return import(util.cleanPath(`${baseUrl}/_aleph/${dep.url.replace(reModuleExt, '')}.${dep.hash.slice(0, hashShort)}.js`))
            }) || [])
            if (util.isLikelyReactComponent(Component)) {
                setPage({ url, Component })
            } else {
                setPage({
                    url,
                    Component: E501Page
                })
            }
        } else {
            setPage({ url, Component: null })
        }
    }, [routing, locales])

    useEffect(() => {
        window.addEventListener('popstate', onpopstate)
        events.on('popstate', onpopstate)

        return () => {
            window.removeEventListener('popstate', onpopstate)
            events.off('popstate', onpopstate)
        }
    }, [onpopstate])

    useEffect(() => {
        const { baseUrl } = initial
        const onUpdateData = (data: any) => {
            console.log('[DATA]', data)
            setStaticData(data)
        }
        const onAddModule = async (mod: Module) => {
            if (mod.id === '/404.js') {
                const { default: Component } = await import(getModuleImportUrl(baseUrl, mod) + '?t=' + Date.now())
                if (util.isLikelyReactComponent(Component)) {
                    setE404({ Component })
                } else {
                    setE404({ Component: E404Page })
                }
            } else if (mod.id === '/app.js') {
                const { default: Component } = await import(getModuleImportUrl(baseUrl, mod) + '?t=' + Date.now())
                if (util.isLikelyReactComponent(Component)) {
                    setApp({ Component })
                } else {
                    setPage(({ url }) => ({
                        url,
                        Component: E501App
                    }))
                }
            } else if (mod.id === '/data.js') {
                const { default: data } = await import(getModuleImportUrl(baseUrl, mod) + '?t=' + Date.now())
                console.log('[DATA]', data)
                setStaticData(data)
            } else if (mod.id.startsWith('/pages/')) {
                const pagePath = util.trimSuffix(mod.id, '.js').replace(/\s+/g, '-').replace(/\/?index$/i, '/')
                setRouting(pageModules => ({
                    ...pageModules,
                    [pagePath]: mod
                }))
            }
        }
        const onRemoveModule = (moduleId: string) => {
            if (moduleId === '/404.js') {
                setE404({ Component: E404Page })
            } else if (moduleId === '/app.js') {
                setApp({ Component: null })
            } else if (moduleId === '/data.js') {
                console.log('[DATA]', {})
                setStaticData({})
            } else if (moduleId.startsWith('/pages/')) {
                setRouting(pageModules => {
                    const newPageModules: Record<string, Module> = {}
                    for (const pagePath in pageModules) {
                        const mod = pageModules[pagePath]
                        if (mod.id !== moduleId) {
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
    }, [])

    return (
        React.createElement(
            ErrorBoundary,
            null,
            React.createElement(
                DataContext.Provider,
                { value: staticData },
                React.createElement(
                    RouterContext.Provider,
                    { value: page.url },
                    ...[
                        (page.Component && app.Component) && React.createElement(app.Component, { Page: page.Component }),
                        (page.Component && !app.Component) && React.createElement(page.Component),
                        !page.Component && React.createElement(e404.Component)
                    ].filter(Boolean),
                )
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

export function getModuleImportUrl(baseUrl: string, mod: Module) {
    return util.cleanPath(baseUrl + '/_aleph/' + util.trimSuffix(mod.id, '.js') + `.${mod.hash.slice(0, hashShort)}.js`)
}
