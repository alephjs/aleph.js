import { createContext } from 'https://esm.sh/react'
import type { RouterURL } from '../../types.ts'
import { createNamedContext } from './util.ts'

export const RouterContext = createNamedContext<RouterURL>({
    locale: 'en',
    pagePath: '/',
    pathname: '/',
    params: {},
    query: new URLSearchParams(),
}, 'RouterContext')

type RendererContextProps = {
    headElements: Map<string, { type: string, props: Record<string, any> }>
    scriptsElements: Map<string, { type: string, props: Record<string, any> }>
}
export const RendererContext = createContext<RendererContextProps>({
    headElements: new Map(),
    scriptsElements: new Map()
})
