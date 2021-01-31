import type { ComponentType } from 'https://esm.sh/react'
import { createElement } from 'https://esm.sh/react'
import { hydrate, render } from 'https://esm.sh/react-dom'
import { Route, RouteModule, Routing, trimPageModuleExt } from '../core/routing.ts'
import Router from './router.ts'
import { importModule } from './util.ts'

type BootstrapOptions = {
    baseUrl: string
    defaultLocale: string
    locales: string[]
    routes: Route[]
    sharedModules: RouteModule[],
    renderMode: 'ssr' | 'spa'
}

export default async function bootstrap({ baseUrl, defaultLocale, locales, routes, sharedModules, renderMode }: BootstrapOptions) {
    const { document } = window as any
    const ssrDataEl = document.querySelector('#ssr-data')
    const routing = new Routing(routes, baseUrl, defaultLocale, locales)
    const [url, pageModuleTree] = routing.createRouter()
    const pageComponentTree: { url: string, Component?: ComponentType }[] = pageModuleTree.map(({ url }) => ({ url }))
    const customComponents: Record<string, ComponentType> = {}

    await Promise.all([...sharedModules, ...pageModuleTree].map(async mod => {
        const { default: C } = await importModule(baseUrl, mod)
        switch (trimPageModuleExt(mod.url)) {
            case '/404':
                customComponents['E404'] = C
                break
            case '/app':
                customComponents['App'] = C
                break
            default:
                const pc = pageComponentTree.find(pc => pc.url === mod.url)
                if (pc) {
                    pc.Component = C
                }
                break
        }
    }))

    if (ssrDataEl) {
        const ssrData = JSON.parse(ssrDataEl.innerText)
        for (const key in ssrData) {
            Object.assign(window, { [`data://${url.pathname}#${key}`]: ssrData[key] })
        }
    }

    const rootEl = createElement(
        Router,
        {
            url,
            routing,
            customComponents,
            pageComponentTree
        }
    )
    const mountPoint = document.getElementById('__aleph')
    if (renderMode === 'ssr') {
        hydrate(rootEl, mountPoint)
    } else {
        render(rootEl, mountPoint)
    }

    // remove ssr head elements, set a timmer to avoid the tab title flash
    setTimeout(() => {
        Array.from(document.head.children).forEach((el: any) => {
            if (el.hasAttribute('ssr') && el.tagName.toLowerCase() !== 'style') {
                document.head.removeChild(el)
            }
        })
    }, 0)
}
