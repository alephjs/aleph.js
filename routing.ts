import util, { reMDExt, reModuleExt } from './shared/util.ts'
import type { DependencyDescriptor, RouterURL } from './types.ts'

export interface Route {
    path: string
    module: RouteModule
    children?: Route[]
}

export interface RouteModule {
    readonly url: string
    readonly hash: string
    readonly deps?: DependencyDescriptor[]
}

const ghostRoute: Route = { path: '', module: { url: '', hash: '' } }

export class Routing {
    private _routes: Route[]
    private _baseUrl: string
    private _defaultLocale: string
    private _locales: string[]

    constructor(
        routes: Route[] = [],
        baseUrl: string = '/',
        defaultLocale: string = 'en',
        locales: string[] = []
    ) {
        this._routes = routes
        this._baseUrl = baseUrl
        this._defaultLocale = defaultLocale
        this._locales = locales
    }

    get baseUrl() {
        return this._baseUrl
    }

    get paths() {
        const paths: string[] = []
        this._lookup(path => { paths.push(path.map(r => r.path).join('')) }, true)
        return paths
    }

    // routes returns the routes as copy
    get routes(): Route[] {
        return JSON.parse(JSON.stringify(this._routes))
    }

    update(module: RouteModule) {
        const newRoute: Route = { path: getPagePath(module.url), module }
        const dirtyRoutes: Set<Route[]> = new Set()
        let exists = false
        let targetRoutes = this._routes
        this._lookup(routePath => {
            const path = routePath.map(r => r.path).join('')
            const route = routePath[routePath.length - 1]
            const parentRoute = routePath[routePath.length - 2]
            if (route.module.url === module.url) {
                Object.assign(route.module, module)
                exists = true
                return false
            }
            if (!newRoute.path.endsWith('/') && path.startsWith(newRoute.path + '/')) {
                const routes = parentRoute ? parentRoute.children! : this._routes
                const index = routes.indexOf(route)
                if (index >= 0) {
                    routes.splice(index, 1, ghostRoute)
                    dirtyRoutes.add(routes)
                }
                (newRoute.children || (newRoute.children = [])).push({ ...route, path: util.trimPrefix(path, newRoute.path) })
            } else if (!path.endsWith('/') && newRoute.path.startsWith(path + '/')) {
                newRoute.path = util.trimPrefix(newRoute.path, path)
                targetRoutes = route.children || (route.children = [])
            }
        })
        if (exists) {
            return
        }
        dirtyRoutes.forEach(routes => {
            let index: number
            while (~(index = routes.indexOf(ghostRoute))) {
                routes.splice(index, 1)
            }
        })
        dirtyRoutes.clear()
        targetRoutes.push(newRoute)
    }

    removeRoute(url: string) {
        this._lookup(path => {
            const route = path[path.length - 1]
            if (route.module.url === url) {
                const parentRoute = path[path.length - 2]
                const routes = parentRoute ? parentRoute.children! : this._routes
                const index = routes.indexOf(route)
                if (index >= 0) {
                    routes.splice(index, 1, ...(route.children || []).map(r => ({ ...r, path: route.path + r.path })))
                }
                return false
            }
        })
    }

    createRouter(location?: { pathname: string, search?: string }): [RouterURL, RouteModule[]] {
        const loc = location || (window as any).location || { pathname: '/' }
        const query = new URLSearchParams(loc.search)

        let locale = this._defaultLocale
        let pathname = util.cleanPath(util.trimPrefix(loc.pathname, this._baseUrl))
        let pagePath = ''
        let params: Record<string, string> = {}
        let tree: RouteModule[] = []

        if (pathname !== '/' && this._locales.length > 0) {
            const a = pathname.split('/')
            const a1 = a[1]
            if (a1 !== locale && this._locales.includes(a1)) {
                locale = a1
                pathname = '/' + a.slice(2).join('/')
            }
        }

        this._lookup(routePath => {
            const path = routePath.map(r => r.path).join('')
            const [p, ok] = matchPath(path, pathname)
            if (ok) {
                tree = routePath.map(r => r.module)
                const c = routePath[routePath.length - 1].children?.find(c => c.path === '/')
                if (c) {
                    tree.push(c.module)
                }
                pagePath = path
                params = p
                return false
            }
        }, true)

        return [{ locale, pathname, pagePath, params, query }, tree]
    }

    lookup(callback: (path: Route[]) => Boolean | void) {
        this._lookup(callback)
    }

    private _lookup(
        callback: (path: Route[]) => Boolean | void,
        skipNestIndex = false,
        __tracing: Route[] = [],
        __routes = this._routes
    ) {
        for (const route of __routes) {
            if (skipNestIndex && __tracing.length > 0 && route.path === '/') {
                continue
            }
            if (callback([...__tracing, route]) === false) {
                return false
            }
        }
        for (const route of __routes) {
            if (route.path !== '/' && route.children?.length) {
                if (this._lookup(callback, skipNestIndex, [...__tracing, route], route.children) === false) {
                    return false
                }
            }
        }
    }
}

export function getPagePath(url: string): string {
    const pathname = url.replace(reModuleExt, '').replace(reMDExt, '').toLowerCase().replace(/^\/pages\//, '/').replace(/\/?index$/, '/')
    return pathname.startsWith('/api/') ? pathname : pathname.replace(/\s+/g, '-')
}

function matchPath(routePath: string, locPath: string): [Record<string, string>, boolean] {
    const params: Record<string, string> = {}
    const routeSegments = util.splitPath(routePath)
    const locSegments = util.splitPath(locPath)
    const depth = Math.max(routeSegments.length, locSegments.length)

    for (let i = 0; i < depth; i++) {
        const routeSeg = routeSegments[i]
        const locSeg = locSegments[i]

        if (locSeg === undefined || routeSeg === undefined) {
            return [{}, false]
        }

        if (routeSeg.startsWith('[...') && routeSeg.endsWith(']') && routeSeg.length > 5 && i === routeSegments.length - 1) {
            params[routeSeg.slice(4, -1)] = locSegments.slice(i).map(decodeURIComponent).join('/')
            break
        }

        if (routeSeg.startsWith('[') && routeSeg.endsWith(']') && routeSeg.length > 2) {
            params[routeSeg.slice(1, -1)] = decodeURIComponent(locSeg)
        } else if (routeSeg.startsWith('$') && routeSeg.length > 1) {
            params[routeSeg.slice(1)] = decodeURIComponent(locSeg)
        } else if (routeSeg !== locSeg) {
            return [{}, false]
        }
    }

    return [params, true]
}

// export function createPageProps(componentTree: { url: string, Component?: ComponentType<any> }[]): PageProps {
//     const pageProps: PageProps = {
//         Page: null,
//         pageProps: {}
//     }
//     if (componentTree.length > 0) {
//         Object.assign(pageProps, _createPagePropsSegment(componentTree[0]))
//     }
//     if (componentTree.length > 1) {
//         componentTree.slice(1).reduce((p, seg) => {
//             const c = _createPagePropsSegment(seg)
//             p.pageProps = c
//             return c
//         }, pageProps)
//     }
//     return pageProps
// }

// function _createPagePropsSegment(seg: { url: string, Component?: ComponentType<any> }): PageProps {
//     const pageProps: PageProps = {
//         Page: null,
//         pageProps: {}
//     }
//     if (seg.Component) {
//         if (util.isLikelyReactComponent(seg.Component)) {
//             pageProps.Page = seg.Component
//         } else {
//             pageProps.Page = E400MissingDefaultExportAsComponent
//             pageProps.pageProps = { name: 'Page: ' + seg.url.replace(reModuleExt, '') }
//         }
//     }
//     return pageProps
// }
