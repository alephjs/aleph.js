import type { ComponentType } from 'https://esm.sh/react'
import { hashShort, reModuleExt } from '../../shared/constants.ts'
import util from '../../shared/util.ts'
import type { RouterURL } from '../../types.ts'
import { RouteModule } from '../core/routing.ts'
import { E400MissingComponent } from './error.ts'

const symbolFor = typeof Symbol === 'function' && Symbol.for
const REACT_FORWARD_REF_TYPE = symbolFor ? Symbol.for('react.forward_ref') : 0xead0
const REACT_MEMO_TYPE = symbolFor ? Symbol.for('react.memo') : 0xead3

export interface PageProps {
    Page: ComponentType<any> | null
    pageProps: Partial<PageProps> & { name?: string }
}

export function importModule(baseUrl: string, mod: RouteModule, forceRefetch = false): Promise<any> {
    const { __ALEPH, document } = window as any
    if (!__ALEPH || mod.url.startsWith('/pages/')) {
        const src = util.cleanPath(baseUrl + '/_aleph/' + mod.url.replace(reModuleExt, '') + `.${mod.hash.slice(0, hashShort)}.js`) + (forceRefetch ? `?t=${Date.now()}` : '')
        if (__ALEPH) {
            return new Promise((resolve, reject) => {
                const script = document.createElement('script')
                script.onload = () => {
                    resolve(__ALEPH.pack[mod.url])
                }
                script.onerror = (err: Error) => {
                    reject(err)
                }
                script.src = src
                document.body.appendChild(script)
            })
        } else {
            return import(src)
        }
    } else if (__ALEPH && mod.url in __ALEPH.pack) {
        return Promise.resolve(__ALEPH.pack[mod.url])
    } else {
        return Promise.reject(new Error(`Module '${mod.url}' not found`))
    }
}

export async function loadPageData({ pathname }: RouterURL): Promise<void> {
    const url = `/_aleph/data${pathname === '/' ? '/index' : pathname}.json`
    const data = await fetch(url).then(resp => resp.json())
    if (util.isPlainObject(data)) {
        for (const key in data) {
            Object.assign(window, { [`data://${pathname}#${key}`]: data[key] })
        }
    }
}

export function isLikelyReactComponent(type: any): Boolean {
    switch (typeof type) {
        case 'function':
            if (type.prototype != null) {
                if (type.prototype.isReactComponent) {
                    return true
                }
                const ownNames = Object.getOwnPropertyNames(type.prototype)
                if (ownNames.length > 1 || ownNames[0] !== 'constructor') {
                    return false
                }
            }
            const { __ALEPH } = window as any
            if (__ALEPH) {
                // in bundle mode, the component name will be compressed.
                return true
            }
            const name = type.displayName || type.name
            return typeof name === 'string' && /^[A-Z]/.test(name)
        case 'object':
            if (type != null) {
                switch (type.$$typeof) {
                    case REACT_FORWARD_REF_TYPE:
                    case REACT_MEMO_TYPE:
                        return true
                    default:
                        return false
                }
            }
            return false
        default:
            return false
    }
}

export function createPageProps(componentTree: { url: string, Component?: ComponentType<any> }[]): PageProps {
    const pageProps: PageProps = {
        Page: null,
        pageProps: {}
    }
    if (componentTree.length > 0) {
        Object.assign(pageProps, _createPagePropsSegment(componentTree[0]))
    }
    if (componentTree.length > 1) {
        componentTree.slice(1).reduce((p, seg) => {
            const c = _createPagePropsSegment(seg)
            p.pageProps = c
            return c
        }, pageProps)
    }
    return pageProps
}

function _createPagePropsSegment(seg: { url: string, Component?: ComponentType<any> }): PageProps {
    const pageProps: PageProps = {
        Page: null,
        pageProps: {}
    }
    if (seg.Component) {
        if (isLikelyReactComponent(seg.Component)) {
            pageProps.Page = seg.Component
        } else {
            pageProps.Page = E400MissingComponent
            pageProps.pageProps = { name: 'Page: ' + util.trimPrefix(seg.url, '/pages').replace(reModuleExt, '') }
        }
    }
    return pageProps
}
