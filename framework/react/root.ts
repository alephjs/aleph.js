import type { ComponentType } from 'https://esm.sh/react'
import { createElement, useCallback, useEffect, useState } from 'https://esm.sh/react'
import { RouteModule, Routing } from '../../routing.ts'
import events from '../../shared/events.ts'
import util, { hashShort, reModuleExt } from '../../shared/util.ts'
import type { RouterURL } from '../../types.ts'
import { RouterContext } from './context.ts'
import { E400MissingDefaultExportAsComponent, E404Page, ErrorBoundary } from './error.ts'
import { createPageProps, isLikelyReactComponent } from './util.ts'

export function AlephRoot({
    url,
    routing,
    sysComponents,
    pageComponentTree,
}: {
    url: RouterURL
    routing: Routing
    sysComponents: Record<string, ComponentType<any>>
    pageComponentTree: { url: string, Component?: any }[]
}) {
    const [e404, setE404] = useState<{ Component: ComponentType<any>, props?: Record<string, any> }>(() => {
        const { E404 } = sysComponents
        if (E404) {
            if (isLikelyReactComponent(E404)) {
                return { Component: E404 }
            }
            return { Component: E400MissingDefaultExportAsComponent, props: { name: 'Custom 404 Page' } }
        }
        return { Component: E404Page }
    })
    const [app, setApp] = useState<{ Component: ComponentType<any> | null, props?: Record<string, any> }>(() => {
        const { App } = sysComponents
        if (App) {
            if (isLikelyReactComponent(App)) {
                return { Component: App }
            }
            return { Component: E400MissingDefaultExportAsComponent, props: { name: 'Custom App' } }
        }
        return { Component: null }
    })
    const [route, setRoute] = useState(() => ({ ...createPageProps(pageComponentTree), url }))
    const onpopstate = useCallback(async (e: any) => {
        const { baseUrl } = routing
        const [url, pageModuleTree] = routing.createRouter()
        if (url.pagePath !== '') {
            const ctree: { url: string, Component?: ComponentType<any> }[] = pageModuleTree.map(({ url }) => ({ url }))
            const imports = pageModuleTree.map(async mod => {
                const { default: C } = await importModule(baseUrl, mod, e.forceRefetch)
                if (mod.deps && mod.deps.filter(({ isData, url }) => !!isData && url.startsWith('#useDeno-')).length > 0) {
                    const { default: data } = await fetch(`/_aleph/data${url.pathname === '/' ? '/index' : url.pathname}.json`).then(resp => resp.json())
                    if (util.isPlainObject(data)) {
                        for (const key in data) {
                            const useDenoUrl = `useDeno://${url.pathname}#${key}`
                            Object.assign(window, { [useDenoUrl]: data[key] })
                        }
                    }
                }
                const pc = ctree.find(pc => pc.url === mod.url)
                if (pc) {
                    pc.Component = C
                }
            })
            await Promise.all(imports)
            setRoute({ ...createPageProps(ctree), url })
            if (e.resetScroll) {
                (window as any).scrollTo(0, 0)
            }
        } else {
            setRoute({ Page: null, pageProps: {}, url })
        }
    }, [])

    useEffect(() => {
        window.addEventListener('popstate', onpopstate)
        events.on('popstate', onpopstate)

        return () => {
            window.removeEventListener('popstate', onpopstate)
            events.off('popstate', onpopstate)
        }
    }, [onpopstate])

    useEffect(() => {
        const { baseUrl } = routing
        const onAddModule = async (mod: RouteModule) => {
            switch (mod.url) {
                case '/404.js': {
                    const { default: Component } = await importModule(baseUrl, mod, true)
                    if (isLikelyReactComponent(Component)) {
                        setE404({ Component })
                    } else {
                        setE404({ Component: E404Page })
                    }
                    break
                }
                case '/app.js': {
                    const { default: Component } = await importModule(baseUrl, mod, true)
                    if (isLikelyReactComponent(Component)) {
                        setApp({ Component })
                    } else {
                        setApp({ Component: E400MissingDefaultExportAsComponent, props: { name: 'Custom App' } })
                    }
                    break
                }
                default: {
                    if (mod.url.startsWith('/pages/')) {
                        routing.update(mod)
                        events.emit('popstate', { type: 'popstate', forceRefetch: true })
                    }
                    break
                }
            }
        }
        const onRemoveModule = (url: string) => {
            switch (url) {
                case '/404.js':
                    setE404({ Component: E404Page })
                    break
                case '/app.js':
                    setApp({ Component: null })
                    break
                default:
                    if (url.startsWith('/pages/')) {
                        routing.removeRoute(url)
                        events.emit('popstate', { type: 'popstate' })
                    }
                    break
            }
        }
        const onFetchPageModule = async ({ href }: { href: string }) => {
            const [pathname, search] = href.split('?')
            const [url, pageModuleTree] = routing.createRouter({ pathname, search })
            if (url.pagePath !== '') {
                const imports = pageModuleTree.map(async mod => {
                    await importModule(baseUrl, mod)
                    if (mod.deps && mod.deps.filter(({ isData, url }) => !!isData && url.startsWith('#useDeno-')).length > 0) {
                        const { default: data } = await fetch(`/_aleph/data${url.pathname === '/' ? '/index' : url.pathname}.json`).then(resp => resp.json())
                        if (util.isPlainObject(data)) {
                            for (const key in data) {
                                const useDenoUrl = `useDeno://${url.pathname}#${key}`
                                Object.assign(window, { [useDenoUrl]: data[key] })
                            }
                        }
                    }
                })
                await Promise.all(imports)
            }
        }

        events.on('add-module', onAddModule)
        events.on('remove-module', onRemoveModule)
        events.on('fetch-page-module', onFetchPageModule)

        return () => {
            events.off('add-module', onAddModule)
            events.off('remove-module', onRemoveModule)
            events.off('fetch-page-module', onFetchPageModule)
        }
    }, [])

    useEffect(() => {
        const win = window as any
        const { location, document, scrollX, scrollY, hashAnchorScroll } = win
        if (location.hash) {
            const anchor = document.getElementById(location.hash.slice(1))
            if (anchor) {
                const { left, top } = anchor.getBoundingClientRect()
                win.scroll({
                    top: top + scrollY - (hashAnchorScroll?.offset?.top || 0),
                    left: left + scrollX - (hashAnchorScroll?.offset?.left || 0),
                    behavior: hashAnchorScroll?.behavior
                })
            }
        }
    }, [route])

    return (
        createElement(
            ErrorBoundary,
            null,
            createElement(
                RouterContext.Provider,
                { value: route.url },
                ...[
                    (route.Page && app.Component) && createElement(app.Component, Object.assign({}, app.props, { Page: route.Page, pageProps: route.pageProps })),
                    (route.Page && !app.Component) && createElement(route.Page, route.pageProps),
                    !route.Page && createElement(e404.Component, e404.props)
                ].filter(Boolean),
            )
        )
    )
}

export function importModule(baseUrl: string, mod: RouteModule, forceRefetch = false): Promise<any> {
    const { __ALEPH, document } = window as any
    const src = util.cleanPath(baseUrl + '/_aleph/' + mod.url.replace(reModuleExt, '') + `.${mod.hash.slice(0, hashShort)}.js`) + (forceRefetch ? `?t=${Date.now()}` : '')
    if (__ALEPH) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('src')
            script.src = src
            script.onload = () => {
                resolve(__ALEPH.pack[mod.url])
            }
            script.onerror = (err: Error) => {
                reject(err)
            }
            document.body.appendChild(script)
        })
    } else {
        return import(src)
    }
}
