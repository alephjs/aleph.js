import { createElement } from 'https://esm.sh/react@17.0.2'
import { hydrate, render } from 'https://esm.sh/react-dom@17.0.2'
import { importModule } from '../core/module.ts'
import { redirect } from '../core/redirect.ts'
import { Routing, RoutingOptions } from '../core/routing.ts'
import Router, { createPageRoute, importPageModules } from './components/Router.ts'
import { loadSSRDataFromTag, setStaticDataRoutes } from './pagedata.ts'

type BootstrapOptions = Required<RoutingOptions> & {
  renderMode: 'ssr' | 'spa',
  dataRoutes?: string[],
  appModule?: string,
}

export default async function bootstrap(options: BootstrapOptions) {
  const { basePath, i18n, appModule: appModuleSpcifier, routes, dataRoutes, rewrites, renderMode } = options
  const { document } = window as any
  const appModule = appModuleSpcifier ? await importModule(basePath, appModuleSpcifier) : {}
  const routing = new Routing({ basePath, i18n, rewrites, routes, redirect })
  const [url, nestedModules] = routing.createRouter()
  const components = await importPageModules(url, nestedModules)

  if (renderMode === 'ssr') {
    // restore ssr-data from HTML
    // must be called before creating page props
    loadSSRDataFromTag(url)
  }

  const pageRoute = createPageRoute(url, components)
  const routerEl = createElement(Router, { appModule, pageRoute, routing })
  const mountPoint = document.getElementById('__aleph')

  if (renderMode === 'ssr') {
    if (dataRoutes) {
      setStaticDataRoutes(dataRoutes)
    }
    hydrate(routerEl, mountPoint)
  } else {
    render(routerEl, mountPoint)
  }

  // remove ssr head elements
  await Promise.resolve()
  Array.from(document.head.children).forEach((el: any) => {
    const tag = el.tagName.toLowerCase()
    if (
      el.hasAttribute('ssr') &&
      tag !== 'style' &&
      !(tag === 'link' && el.getAttribute('rel') === 'stylesheet')
    ) {
      document.head.removeChild(el)
    }
  })
}
