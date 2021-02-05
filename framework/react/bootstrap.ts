import type { ComponentType } from 'https://esm.sh/react'
import { createElement } from 'https://esm.sh/react'
import { hydrate, render } from 'https://esm.sh/react-dom'
import util from '../../shared/util.ts'
import { RouteModule, Routing, RoutingOptions } from '../core/routing.ts'
import type { PageRoute } from './pageprops.ts'
import { createPageProps } from './pageprops.ts'
import Router from './router.ts'
import { importModule, loadPageDataFromTag } from './util.ts'

type BootstrapOptions = Required<RoutingOptions> & {
  sharedModules: RouteModule[],
  renderMode: 'ssr' | 'spa'
}

export default async function bootstrap(options: BootstrapOptions) {
  const { baseUrl, defaultLocale, locales, routes, rewrites, sharedModules, renderMode } = options
  const { document } = window as any
  const customComponents: Record<string, ComponentType> = {}
  await Promise.all(sharedModules.map(async mod => {
    const { default: C } = await importModule(baseUrl, mod)
    switch (util.trimModuleExt(mod.url)) {
      case '/404':
        customComponents['E404'] = C
        break
      case '/app':
        customComponents['App'] = C
        break
    }
  }))
  const routing = new Routing({ routes, rewrites, baseUrl, defaultLocale, locales })
  const [url, pageModuleChain] = routing.createRouter()
  const imports = await Promise.all(pageModuleChain.map(async mod => {
    const [{ default: Component }] = await Promise.all([
      importModule(baseUrl, mod),
      mod.asyncDeps?.filter(({ isData }) => !!isData).length ? loadPageDataFromTag(url) : Promise.resolve()
    ])
    await Promise.all(mod.asyncDeps?.filter(({ isStyle }) => !!isStyle).map(dep => importModule(baseUrl, dep)) || [])
    return {
      url: mod.url,
      Component,
    }
  }))
  const pageRoute: PageRoute = { ...createPageProps(imports), url }
  const routerEl = createElement(Router, { customComponents, pageRoute, routing })
  const mountPoint = document.getElementById('__aleph')

  if (renderMode === 'ssr') {
    hydrate(routerEl, mountPoint)
  } else {
    render(routerEl, mountPoint)
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
