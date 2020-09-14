import React, { ComponentType, createContext, useContext } from 'https://esm.sh/react'
import type { RouterURL } from './api.ts'

export const RouterContext = createContext<RouterURL>({
    pagePath: '/',
    asPath: '/',
    params: {},
    query: {},
    locale: 'en'
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
