import { createContext } from 'https://esm.sh/react'
import type { RouterURL } from './types.ts'

export const DataContext = createNamedContext<Record<string, any>>(
    'DataContext',
    {}
)

export const RouterContext = createNamedContext<RouterURL>(
    'RouterContext',
    {
        locale: 'en',
        pagePath: '/',
        pathname: '/',
        params: {},
        query: new URLSearchParams(),
    }
)

function createNamedContext<T>(name: string, defaultValue: T) {
    const c = createContext(defaultValue)
    c.displayName = name
    return c
}
