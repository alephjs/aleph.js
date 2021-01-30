import { createContext } from 'https://esm.sh/react'
import type { RouterURL } from '../../types.ts'

export const RouterContext = createContext<RouterURL>({
    locale: 'en',
    pagePath: '/',
    pathname: '/',
    params: {},
    query: new URLSearchParams(),
})
RouterContext.displayName = 'RouterContext'

interface RenderStorage {
    headElements: Map<string, { type: string, props: Record<string, any> }>
    scriptsElements: Map<string, { type: string, props: Record<string, any> }>
}

export const RendererContext = createContext<{ storage: RenderStorage }>({
    storage: {
        headElements: new Map(),
        scriptsElements: new Map()
    }
})
