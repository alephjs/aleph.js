import React, { ComponentType } from 'https://esm.sh/react'
import { hydrate, render } from 'https://esm.sh/react-dom'
import { ALEPH, getModuleImportUrl } from './aleph.ts'
import { E501Page } from './error.ts'
import { Routing } from './router.ts'
import type { PageProps, Route, RouteModule } from './types.ts'
import util, { reModuleExt } from './util.ts'

export default async function bootstrap({
    routes,
    baseUrl,
    defaultLocale,
    locales,
    preloadModules
}: {
    routes: Route[]
    baseUrl: string
    defaultLocale: string
    locales: string[]
    preloadModules: RouteModule[]
}) {
    const { document } = window as any
    const mainEl = document.querySelector('main')
    const routing = new Routing(routes, baseUrl, defaultLocale, locales)
    const [url, pageModuleTree] = routing.createRouter()

    if (url.pagePath === '') {
        throw new Error('invalid router')
    }

    const staticData: Record<string, any> = {}
    const components: Record<string, ComponentType> = {}
    const ctree: { id: string, Component?: ComponentType }[] = pageModuleTree.map(({ id }) => ({ id }))
    const imports = [...preloadModules, ...pageModuleTree].map(async mod => {
        const { default: C } = await import(getModuleImportUrl(baseUrl, mod))
        if (mod.asyncDeps) {
            // import async dependencies
            for (const dep of mod.asyncDeps) {
                await import(getModuleImportUrl(baseUrl, { id: dep.url.replace(reModuleExt, '.js'), hash: dep.hash }))
            }
        }
        switch (mod.id) {
            case '/data.js':
                Object.assign(staticData, C)
                break
            case '/app.js':
                components['App'] = C
                break
            case '/404.js':
                components['E404'] = C
                break
            default:
                const pc = ctree.find(pc => pc.id === mod.id)
                if (pc) {
                    if (util.isLikelyReactComponent(C)) {
                        pc.Component = C
                    } else {
                        pc.Component = E501Page
                    }
                }
                break
        }
    })
    await Promise.all(imports)

    const pageProps: PageProps = {
        Page: ctree[0].Component || (() => null),
        pageProps: {}
    }
    ctree.slice(1).reduce((p, m) => {
        const c = {
            Page: m.Component || (() => null),
            pageProps: {}
        }
        p.pageProps = c
        return c
    }, pageProps)
    const el = React.createElement(
        ALEPH,
        {
            initial: {
                routing,
                url,
                staticData,
                components,
                pageProps
            }
        }
    )

    if (mainEl.childElementCount > 0) {
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
