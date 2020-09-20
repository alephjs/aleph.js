import React, { ComponentType, createContext, useContext } from 'https://esm.sh/react'
import type { RouterURL } from './types.ts'

export const RouterContext = createContext<RouterURL>({
    locale: 'en',
    pagePath: '/',
    pathname: '/',
    params: {},
    query: new URLSearchParams(),
})
RouterContext.displayName = 'RouterContext'

export function withRouter(Component: ComponentType<{ url: RouterURL }>) {
    function WithRouter(props: any) {
        const url = useRouter()
        return React.createElement(Component, Object.assign({}, props, { url }))
    }
    return WithRouter
}

export function useRouter() {
    return useContext(RouterContext)
}
