import type { Location, RouterURL } from './api.ts'
import util from './util.ts'

export default function route(base: string, pagePaths: string[], options?: { location?: { pathname: string, search?: string }, fallback?: string, defaultLocale?: string, locales?: string[] }): RouterURL {
    const { pathname, search }: Location = (options?.location || (window as any).location || { pathname: '/' })
    const asPath = util.cleanPath(util.trimPrefix(pathname, base))
    const query: Record<string, string | string[]> = {}

    if (search) {
        const segs = util.trimPrefix(search, '?').split('&')
        segs.forEach(seg => {
            const [key, value] = util.splitBy(seg, '=')
            if (key in query) {
                const prevValue = query[key]
                if (util.isArray(prevValue)) {
                    prevValue.push(value)
                } else {
                    query[key] = [prevValue, value]
                }
            } else {
                query[key] = value
            }
        })
    }

    let locale = options?.defaultLocale || 'en'
    let asPagePath = asPath
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

    if (pagePath === '' && options?.fallback) {
        pagePath = options?.fallback
    }

    return { locale, pathname: asPath, pagePath, params, query }
}

function matchPath(routePath: string, locPath: string): [Record<string, string>, boolean] {
    const routeSegments = util.splitPath(routePath)
    const locSegments = util.splitPath(locPath)
    const depth = Math.max(routeSegments.length, locSegments.length)
    const params: Record<string, string> = {}

    for (let i = 0; i < depth; i++) {
        const routeSeg = routeSegments[i]
        const locSeg = locSegments[i]

        if (locSeg === undefined || routeSeg === undefined) {
            return [{}, false]
        }

        if (routeSeg.startsWith('$') && routeSeg.length > 1) {
            params[routeSeg.slice(1)] = decodeURIComponent(locSeg)
        } else if (routeSeg.startsWith('~') && routeSeg.length > 1 && i === routeSegments.length - 1) {
            params[routeSeg.slice(1)] = locSegments.slice(i).map(decodeURIComponent).join('/')
            break
        } else if (routeSeg !== locSeg) {
            return [{}, false]
        }
    }

    return [params, true]
}
