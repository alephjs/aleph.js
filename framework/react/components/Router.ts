import {
  ComponentType,
  createElement,
  useCallback,
  useEffect,
  useState,
} from 'https://esm.sh/react@17.0.2'
import events from '../../core/events.ts'
import { importModule } from '../../core/module.ts'
import { RouteModule, Routing } from '../../core/routing.ts'
import { RouterContext } from '../context.ts'
import { isLikelyReactComponent } from '../helper.ts'
import { loadPageData } from '../pagedata.ts'
import { createPageProps } from '../pageprops.ts'
import { E400MissingComponent, E404Page, ErrorBoundary } from './ErrorBoundary.ts'
import type { PageRoute } from './pageprops.ts'

export default function Router({
  customComponents,
  pageRoute,
  routing,
}: {
  customComponents: Record<'E404' | 'App', { C: ComponentType, withData?: boolean }>
  pageRoute: PageRoute,
  routing: Routing
}) {
  const appWithData = !!customComponents.App?.withData
  const [e404, setE404] = useState<{ Component: ComponentType<any>, props?: Record<string, any> }>(() => {
    const { E404 } = customComponents
    if (E404) {
      if (isLikelyReactComponent(E404.C)) {
        return { Component: E404.C }
      }
      return { Component: E400MissingComponent, props: { name: 'Custom 404 Page' } }
    }
    return { Component: E404Page }
  })
  const [app, setApp] = useState<{ Component: ComponentType<any> | null, props?: Record<string, any> }>(() => {
    const { App } = customComponents
    if (App) {
      if (isLikelyReactComponent(App.C)) {
        return { Component: App.C }
      }
      return { Component: E400MissingComponent, props: { name: 'Custom App' } }
    }
    return { Component: null }
  })
  const [route, setRoute] = useState<PageRoute>(pageRoute)
  const onpopstate = useCallback(async (e: any) => {
    const { basePath } = routing
    const [url, nestedModules] = routing.createRouter()
    if (url.routePath !== '') {
      const imports = nestedModules.map(async mod => {
        const { default: Component } = await importModule(basePath, mod.url, e.forceRefetch)
        return {
          url: mod.url,
          Component
        }
      })
      if (appWithData || nestedModules.findIndex(mod => !!mod.withData) > -1) {
        await loadPageData(url)
      }
      setRoute({ ...createPageProps(await Promise.all(imports)), url })
      if (e.resetScroll) {
        (window as any).scrollTo(0, 0)
      }
    } else {
      setRoute({ Page: null, pageProps: null, url })
    }
  }, [])

  useEffect(() => {
    window.addEventListener('popstate', onpopstate)
    events.on('popstate', onpopstate)
    events.emit('routerstate', { ready: true })

    return () => {
      window.removeEventListener('popstate', onpopstate)
      events.off('popstate', onpopstate)
    }
  }, [])

  useEffect(() => {
    const isDev = !('__ALEPH' in window)
    const { basePath } = routing
    const onAddModule = async (mod: RouteModule & { routePath?: string, isIndex?: boolean }) => {
      switch (mod.url) {
        case '/404.js': {
          const { default: Component } = await importModule(basePath, mod.url, true)
          if (isLikelyReactComponent(Component)) {
            setE404({ Component })
          } else {
            setE404({ Component: E404Page })
          }
          break
        }
        case '/app.js': {
          const { default: Component } = await importModule(basePath, mod.url, true)
          if (isLikelyReactComponent(Component)) {
            setApp({ Component })
          } else {
            setApp({ Component: E400MissingComponent, props: { name: 'Custom App' } })
          }
          break
        }
        default: {
          const { routePath, url, ...rest } = mod
          if (routePath) {
            routing.update(routePath, url, rest)
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
      const [url, nestedModules] = routing.createRouter({ pathname: href })
      if (url.routePath !== '') {
        nestedModules.map(mod => {
          importModule(basePath, mod.url)
        })
        if (appWithData || nestedModules.findIndex(mod => !!mod.withData) > -1) {
          loadPageData(url)
        }
      }
    }

    if (isDev) {
      events.on('add-module', onAddModule)
      events.on('remove-module', onRemoveModule)
      events.on('fetch-page-module', onFetchPageModule)
    }

    return () => {
      if (isDev) {
        events.off('add-module', onAddModule)
        events.off('remove-module', onRemoveModule)
        events.off('fetch-page-module', onFetchPageModule)
      }
    }
  }, [])

  useEffect(() => {
    const win = window as any
    const { location, document, scrollX, scrollY, scrollFixer } = win
    if (location.hash) {
      const anchor = document.getElementById(location.hash.slice(1))
      if (anchor) {
        const { left, top } = anchor.getBoundingClientRect()
        win.scroll({
          top: top + scrollY - (scrollFixer?.offset?.top || 0),
          left: left + scrollX - (scrollFixer?.offset?.left || 0),
          behavior: scrollFixer?.behavior
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

Router.displayName = 'ALEPH' // show in devTools
