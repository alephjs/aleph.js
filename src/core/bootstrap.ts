import React, { ComponentType } from 'https://esm.sh/react'
import { hydrate, render } from 'https://esm.sh/react-dom'
import { ALEPH, getModuleImportUrl } from '../../aleph.ts'
import { Route, RouteModule, Routing } from '../../routing.ts'
import util, { reHttp } from '../helpers/util.ts'

export default async function bootstrap({
    routes,
    baseUrl,
    defaultLocale,
    locales,
    preloadModules,
    renderMode
}: {
    routes: Route[]
    baseUrl: string
    defaultLocale: string
    locales: string[]
    preloadModules: RouteModule[],
    renderMode: 'ssr' | 'spa'
}) {
    const { document } = window as any
    const mainEl = document.querySelector('main')
    const ssrDataEl = document.querySelector('#ssr-data')
    const components: Record<string, ComponentType> = {}
    const routing = new Routing(routes, baseUrl, defaultLocale, locales)
    const [url, pageModuleTree] = routing.createRouter()
    const pageComponentTree: { id: string, Component?: ComponentType }[] = pageModuleTree.map(({ id }) => ({ id }))
    const imports = [...preloadModules, ...pageModuleTree].map(async mod => {
        const { default: C } = await import(getModuleImportUrl(baseUrl, mod))
        if (mod.deps) {
            // import async dependencies
            for (const dep of mod.deps.filter(({ isStyle }) => !!isStyle)) {
                await import(getModuleImportUrl(baseUrl, { id: util.ensureExt(dep.url.replace(reHttp, '/-/'), '.js'), hash: dep.hash }))
            }
        }
        switch (mod.id) {
            case '/app.js':
                components['App'] = C
                break
            case '/404.js':
                components['E404'] = C
                break
            default:
                const pc = pageComponentTree.find(pc => pc.id === mod.id)
                if (pc) {
                    pc.Component = C
                }
                break
        }
    })
    await Promise.all(imports)

    if (ssrDataEl) {
        const ssrData = JSON.parse(ssrDataEl.innerText)
        for (const key in ssrData) {
            Object.assign(window, { [`useDeno://${url.pathname}?${url.query.toString()}#${key}`]: ssrData[key] })
        }
    }

    const el = React.createElement(
        ALEPH,
        {
            initial: {
                routing,
                url,
                components,
                pageComponentTree,
            }
        }
    )
    if (renderMode === 'ssr') {
        hydrate(el, mainEl)
    } else {
        render(el, mainEl)
    }

    // remove ssr head elements, set a timmer to avoid the tab title flash
    setTimeout(() => {
        Array.from(document.head.children).forEach((el: any) => {
            if (el.hasAttribute('ssr')) {
                document.head.removeChild(el)
            }
        })
    }, 0)
}
