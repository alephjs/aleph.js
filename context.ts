import { createContext } from 'https://esm.sh/react'
import type { RouterURL } from './types.ts'

export const RouterContext = createContext<RouterURL>({
    locale: 'en',
    pagePath: '/',
    pathname: '/',
    params: {},
    query: new URLSearchParams(),
})
RouterContext.displayName = 'RouterContext'
