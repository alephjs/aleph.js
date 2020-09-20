import type { RouterURL } from './types.ts'
import util from './util.ts'

export default function route(base: string, pagePaths: string[], options?: { location?: { pathname: string, search?: string }, defaultLocale?: string, locales?: string[] }): RouterURL {
    const loc = (options?.location || (window as any).location || { pathname: '/' })
    const pathname = util.cleanPath(util.trimPrefix(loc.pathname, base))
    const query = new URLSearchParams(loc.search)

    let locale = options?.defaultLocale || 'en'
    let asPagePath = pathname
    let pagePath = ''
    let params: Record<string, string> = {}

    if (asPagePath !== '/') {
        const a = asPagePath.split('/')
        if (options?.locales?.includes(a[0])) {
            locale = a[0]
            asPagePath = '/' + a.slice(1).join('/')
        }
    }

    for (const routePath of pagePaths) {
        const [p, ok] = matchPath(routePath, asPagePath)
        if (ok) {
            pagePath = routePath
            params = p
            break
        }
    }

    return { locale, pathname, pagePath, params, query }
}

function matchPath(routePath: string, realPath: string): [Record<string, string>, boolean] {
    const params: Record<string, string> = {}
    const routeSegments = util.splitPath(routePath)
    const locSegments = util.splitPath(realPath)
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
