import React from 'https://esm.sh/react'
import { hydrate, render } from 'https://esm.sh/react-dom'
import { ALEPH, getModuleImportUrl } from './app.ts'
import { createRouter } from './router.ts'
import type { Module, RouterURL } from './types.ts'
import util, { hashShort, reModuleExt } from './util.ts'

export default async function bootstrap({
    baseUrl,
    defaultLocale,
    locales,
    staticDataModule,
    customAppModule,
    custom404Module,
    routing
}: {
    baseUrl: string
    defaultLocale: string
    locales: string[]
    staticDataModule?: Module
    customAppModule?: Module
    custom404Module?: Module
    routing: Record<string, Module>
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
        url = createRouter(
            baseUrl,
            Object.keys(routing),
            {
                defaultLocale,
                locales: Object.keys(locales)
            }
        )
    }

    const pageModule = routing[url.pagePath]
    if (!pageModule) {
        throw new Error('page module not found')
    }

    const [
        { default: staticData },
        { default: App },
        { default: E404 },
        { default: Page }
    ] = await Promise.all([
        staticDataModule ? import(getModuleImportUrl(baseUrl, staticDataModule)) : Promise.resolve({ default: {} }),
        customAppModule ? import(getModuleImportUrl(baseUrl, customAppModule)) : Promise.resolve({}),
        custom404Module ? import(getModuleImportUrl(baseUrl, custom404Module)) : Promise.resolve({}),
        import(getModuleImportUrl(baseUrl, pageModule))
    ])
    const el = React.createElement(
        ALEPH,
        {
            initial: {
                baseUrl,
                defaultLocale,
                locales,
                routing,
                url,
                staticData,
                components: { E404, App, Page }
            }
        }
    )

    // import async style dependencies
    const asyncDeps: { url: string, hash: string }[] = []
    customAppModule?.asyncDeps?.forEach(deps => asyncDeps.push(deps))
    custom404Module?.asyncDeps?.forEach(deps => asyncDeps.push(deps))
    pageModule.asyncDeps?.forEach(deps => asyncDeps.push(deps))
    await Promise.all(asyncDeps.map(dep => {
        return import(util.cleanPath(`${baseUrl}/_aleph/${dep.url.replace(reModuleExt, '')}.${dep.hash.slice(0, hashShort)}.js`))
    }))

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
