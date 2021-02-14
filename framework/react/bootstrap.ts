import type { ComponentType } from 'https://esm.sh/react'
import { createElement } from 'https://esm.sh/react'
import { hydrate, render } from 'https://esm.sh/react-dom'
import util from '../../shared/util.ts'
import type { RouteModule, RoutingOptions } from '../core/routing.ts'
import { Routing } from '../core/routing.ts'
import { importModule, loadPageDataFromTag } from './helper.ts'
import type { PageRoute } from './pageprops.ts'
import { createPageProps } from './pageprops.ts'
import Router from './router.ts'

type BootstrapOptions = Required<RoutingOptions> & {
  sharedModules: RouteModule[],
  renderMode: 'ssr' | 'spa'
}

export default async function bootstrap(options: BootstrapOptions) {
  const { baseURL, defaultLocale, locales, routes, rewrites, sharedModules, renderMode } = options
  const { document } = window as any
  const customComponents: Record<string, ComponentType> = {}
  await Promise.all(sharedModules.map(async mod => {
    const { default: C } = await importModule(baseURL, mod)
    switch (util.trimModuleExt(mod.url)) {
      case '/404':
        customComponents['E404'] = C
        break
      case '/app':
        customComponents['App'] = C
        break
    }
  }))
  const routing = new Routing({ routes, rewrites, baseURL, defaultLocale, locales })
  const [url, nestedModules] = routing.createRouter()
  const imports = await Promise.all(nestedModules.map(async mod => {
    const [{ default: Component }] = await Promise.all([
      importModule(baseURL, mod),
      mod.hasData ? loadPageDataFromTag(url) : Promise.resolve()
    ])
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
