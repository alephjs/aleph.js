import { ComponentType, createElement, useCallback, useEffect, useState } from 'https://esm.sh/react@17.0.2'
import { RouterURL } from '../../../types.d.ts'
import events from '../../core/events.ts'
import { importModule, trimBuiltinModuleExts } from '../../core/module.ts'
import { Routing } from '../../core/routing.ts'
import { RouterContext } from '../context.ts'
import { isLikelyReactComponent } from '../helper.ts'
import { shouldLoadData, loadPageData } from '../pagedata.ts'
import type { PageProps } from '../pageprops.ts'
import { createPageProps } from '../pageprops.ts'
import { E400MissingComponent, E404Page, ErrorBoundary } from './ErrorBoundary.ts'

type PageRoute = PageProps & {
  url: RouterURL
}

export async function importPageModules(url: RouterURL, nestedModules: string[], refresh = false): Promise<{ specifier: string, Component: any }[]> {
  return await Promise.all(nestedModules.map(async specifier => {
    const { default: Component } = await importModule(url.basePath, specifier, refresh)
    return {
      specifier,
      Component
    }
  }))
}

export function createPageRoute(url: RouterURL, nestedModules: { specifier: string, Component: any }[]): PageRoute {
  const nest = nestedModules.map(({ specifier, Component }) => {
    const data = (window as any)[`pagedata://${url.toString()}#props-${btoa(specifier)}`] || {}
    return {
      specifier,
      Component,
      props: { ...data.value }
    }
  })
  return { ...createPageProps(nest), url }
}

export default function Router({
  appModule,
  pageRoute,
  routing,
}: {
  appModule: {
    default?: ComponentType
    Loading?: ComponentType
  }
  pageRoute: PageRoute
  routing: Routing
}) {
  const [app, setApp] = useState<{ Component: ComponentType<any> | null }>(() => {
    const App = appModule.default
    if (App) {
      if (isLikelyReactComponent(App)) {
        return { Component: App }
      }
      return { Component: E400MissingComponent, props: { name: 'Custom App' } }
    }
    return { Component: null }
  })
  const [route, setRoute] = useState<PageRoute>(pageRoute)
  const onpopstate = useCallback(async (e: any) => {
    const [url, nestedModules] = routing.createRouter()
    if (url.routePath !== '') {
      const components = await importPageModules(url, nestedModules, e.forceRefetch)
      if (await shouldLoadData(url)) {
        await loadPageData(url)
      }
      setRoute(createPageRoute(url, components))
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
    const isDev = !('__ALEPH__' in window)
    const { basePath } = routing
    const onAddModule = async (mod: { specifier: string, routePath?: string, isIndex?: boolean }) => {
      const name = trimBuiltinModuleExts(mod.specifier)
      if (name === '/app') {
        const { default: Component } = await importModule(basePath, mod.specifier, true)
        if (isLikelyReactComponent(Component)) {
          setApp({ Component })
        } else {
          setApp({ Component: () => createElement(E400MissingComponent, { name: 'Custom App' }) })
        }
      } else {
        const { routePath, specifier, isIndex } = mod
        if (routePath) {
          routing.update(routePath, specifier, isIndex)
          events.emit('popstate', { type: 'popstate', forceRefetch: true })
        }
      }
    }
    const onRemoveModule = (specifier: string) => {
      const name = trimBuiltinModuleExts(specifier)
      if (name === '/app') {
        setApp({ Component: null })
      } else if (specifier.startsWith('/pages/')) {
        routing.removeRouteByModule(specifier)
        events.emit('popstate', { type: 'popstate' })
      }
    }
    const onFetchPageModule = async ({ href }: { href: string }) => {
      const [url, nestedModules] = routing.createRouter({ pathname: href })
      if (url.routePath !== '') {
        nestedModules.map(modUrl => {
          importModule(basePath, modUrl)
        })
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
          (route.Page && app.Component) && createElement(app.Component, route),
          (route.Page && !app.Component) && createElement(route.Page, route.pageProps),
          !route.Page && createElement(E404Page)
        ].filter(Boolean),
      )
    )
  )
}

Router.displayName = 'ALEPH' // show in devTools
