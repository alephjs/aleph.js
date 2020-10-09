import React, { ComponentType, useContext } from 'https://esm.sh/react'
import { DataContext, RouterContext } from './context.ts'
import type { RouterURL } from './types.ts'

export function useData(key: string) {
    const data = useContext(DataContext)
    return data[key]
}

export function useRouter() {
    return useContext(RouterContext)
}

export function withRouter(Component: ComponentType<{ url: RouterURL }>) {
    function WithRouter(props: any) {
        const url = useRouter()
        return React.createElement(Component, Object.assign({}, props, { url }))
    }
    return WithRouter
}