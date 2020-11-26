import React, { ComponentType, useCallback, useEffect, useRef, useState } from 'https://esm.sh/react'
import { RouterContext } from './context.ts'
import { E400MissingDefaultExportAsComponent, E404Page, ErrorBoundary } from './error.ts'
import events from './events.ts'
import { createPageProps, RouteModule, Routing } from './routing.ts'
import type { RouterURL } from './types.ts'
import util, { hashShort, reHttp } from './util.ts'

export function ALEPH({ initial }: {
    initial: {
        routing: Routing
        url: RouterURL
        components: Record<string, ComponentType<any>>
        pageComponentTree: { id: string, Component?: any }[]
    }
}) {
    const ref = useRef({ routing: initial.routing })
    const [e404, setE404] = useState<{ Component: ComponentType<any>, props?: Record<string, any> }>(() => {
        const { E404 } = initial.components
        if (E404) {
            if (util.isLikelyReactComponent(E404)) {
                return { Component: E404 }
            }
            return { Component: E400MissingDefaultExportAsComponent, props: { name: 'Custom 404 Page' } }
        }
        return { Component: E404Page }
    })
    const [app, setApp] = useState<{ Component: ComponentType<any> | null, props?: Record<string, any> }>(() => {
        const { App } = initial.components
        if (App) {
            if (util.isLikelyReactComponent(App)) {
                return { Component: App }
            }
            return { Component: E400MissingDefaultExportAsComponent, props: { name: 'Custom App' } }
        }
        return { Component: null }
    })
    const [route, setRoute] = useState(() => {
        const { url, pageComponentTree } = initial
        return { ...createPageProps(pageComponentTree), url }
    })
    const onpopstate = useCallback(async (e: any) => {
        const { routing } = ref.current
        const { baseUrl } = routing
        const [url, pageModuleTree] = routing.createRouter()
        if (url.pagePath !== '') {
            const ctree: { id: string, Component?: ComponentType<any> }[] = pageModuleTree.map(({ id }) => ({ id }))
            const imports = pageModuleTree.map(async mod => {
                const { default: C } = await import(getModuleImportUrl(baseUrl, mod, e.forceRefetch))
                if (mod.deps) {
                    // import async dependencies
                    for (const dep of mod.deps.filter(({ isStyle }) => !!isStyle)) {
                        await import(getModuleImportUrl(baseUrl, { id: util.ensureExt(dep.url.replace(reHttp, '/-/'), '.js'), hash: dep.hash }, e.forceRefetch))
                    }
                    if (mod.deps.filter(({ isData, url }) => !!isData && url.startsWith('#useDeno.')).length > 0) {
                        const { default: data } = await import(`/_aleph/data${[url.pathname, url.query.toString()].filter(Boolean).join('@')}/data.js` + (e.forceRefetch ? `?t=${Date.now()}` : ''))
                        if (util.isPlainObject(data)) {
                            for (const key in data) {
                                const useDenoUrl = `useDeno://${url.pathname}?${url.query.toString()}#${key}`
                                Object.assign(window, { [useDenoUrl]: data[key] })
                            }
                        }
                    }
                }
                const pc = ctree.find(pc => pc.id === mod.id)
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
    }, [ref])

    useEffect(() => {
        window.addEventListener('popstate', onpopstate)
        events.on('popstate', onpopstate)

        return () => {
            window.removeEventListener('popstate', onpopstate)
            events.off('popstate', onpopstate)
        }
    }, [onpopstate])

    useEffect(() => {
        const { routing } = ref.current
        const { baseUrl } = routing
        const onAddModule = async (mod: RouteModule) => {
            switch (mod.id) {
                case '/404.js': {
                    const { default: Component } = await import(getModuleImportUrl(baseUrl, mod, true))
                    if (util.isLikelyReactComponent(Component)) {
                        setE404({ Component })
                    } else {
                        setE404({ Component: E404Page })
                    }
                    break
                }
                case '/app.js': {
                    const { default: Component } = await import(getModuleImportUrl(baseUrl, mod, true))
                    if (util.isLikelyReactComponent(Component)) {
                        setApp({ Component })
                    } else {
                        setApp({ Component: E400MissingDefaultExportAsComponent, props: { name: 'Custom App' } })
                    }
                    break
                }
                default: {
                    if (mod.id.startsWith('/pages/')) {
                        const { routing } = ref.current
                        routing.update(mod)
                        events.emit('popstate', { type: 'popstate', forceRefetch: true })
                    }
                    break
                }
            }
        }
        const onRemoveModule = (moduleId: string) => {
            switch (moduleId) {
                case '/404.js':
                    setE404({ Component: E404Page })
                    break
                case '/app.js':
                    setApp({ Component: null })
                    break
                default:
                    if (moduleId.startsWith('/pages/')) {
                        const { routing } = ref.current
                        routing.removeRoute(moduleId)
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
                    await import(getModuleImportUrl(baseUrl, mod))
                    if (mod.deps) {
                        // import async dependencies
                        for (const dep of mod.deps.filter(({ isStyle }) => !!isStyle)) {
                            await import(getModuleImportUrl(baseUrl, { id: util.ensureExt(dep.url.replace(reHttp, '/-/'), '.js'), hash: dep.hash }))
                        }
                        if (mod.deps.filter(({ isData, url }) => !!isData && url.startsWith('#useDeno.')).length > 0) {
                            const { default: data } = await import(`/_aleph/data${[url.pathname, url.query.toString()].filter(Boolean).join('@')}/data.js`)
                            if (util.isPlainObject(data)) {
                                for (const key in data) {
                                    const useDenoUrl = `useDeno://${url.pathname}?${url.query.toString()}#${key}`
                                    Object.assign(window, { [useDenoUrl]: data[key] })
                                }
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
    }, [ref])

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
        React.createElement(
            ErrorBoundary,
            null,
            React.createElement(
                RouterContext.Provider,
                { value: route.url },
                ...[
                    (route.Page && app.Component) && React.createElement(app.Component, Object.assign({}, app.props, { Page: route.Page, pageProps: route.pageProps })),
                    (route.Page && !app.Component) && React.createElement(route.Page, route.pageProps),
                    !route.Page && React.createElement(e404.Component, e404.props)
                ].filter(Boolean),
            )
        )
    )
}

export function getModuleImportUrl(baseUrl: string, mod: RouteModule, forceRefetch = false) {
    return util.cleanPath(baseUrl + '/_aleph/' + (mod.id.startsWith('/-/') ? mod.id : util.trimSuffix(mod.id, '.js') + `.${mod.hash.slice(0, hashShort)}.js`) + (forceRefetch ? `?t=${Date.now()}` : ''))
}

