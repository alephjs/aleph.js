import React from 'https://esm.sh/react'
import { hydrate, render } from 'https://esm.sh/react-dom'
import { ALEPH, getModuleImportUrl } from './app.ts'
import { ErrorBoundary } from './error.ts'
import route from './route.ts'
import type { AppManifest, Module, RouterURL } from './types.ts'
import util from './util.ts'

export default async function bootstrap({
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
        ErrorBoundary,
        null,
        React.createElement(
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
