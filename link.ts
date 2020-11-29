import React, { ComponentType, LinkHTMLAttributes, useEffect, useState } from 'https://esm.sh/react'
import { removeCSS } from './style.ts'
import util from './util.ts'

type LinkProps = LinkHTMLAttributes<{}> & {
    ['data-fallback']?: JSX.Element
    ['data-props']?: any
    ['data-export-name']?: string
    __url?: string
    __base?: string
}

export default function Link({
    rel,
    href,
    ['data-fallback']: fallback,
    ['data-props']: compProps,
    ['data-export-name']: exportName,
    __url,
    __base
}: LinkProps) {
    const [error, setError] = useState<string | null>(null)
    const [mod, setMod] = useState<{ Component: ComponentType | null }>({ Component: null })

    useEffect(() => {
        // todo: resolve baseUrl
        let fixedHref = util.cleanPath('/_aleph/' + (__base||'') + '/' + href)
        if (rel === 'component') {
            setMod({ Component: null })
            import(fixedHref)
                .then(mod => {
                    const Component = mod[exportName || 'default']
                    if (util.isLikelyReactComponent(Component)) {
                        setMod({ Component })
                    } else {
                        setError(`component${exportName ? ` '${exportName}'` : ''} not found`)
                    }
                })
                .catch((err: Error) => {
                    setError(err.message)
                })
        } else if (rel === 'style' || rel === 'stylesheet') {
            import(fixedHref)
            return () => __url  ? removeCSS(__url) : null
        }
    }, [rel, href, exportName, __url, __base])

    if (error) {
        return React.createElement('div', { style: { color: 'red' } }, error)
    }

    if (mod.Component) {
        return React.createElement(mod.Component, compProps)
    }

    if (rel === 'component' && fallback) {
        return fallback
    }

    return null
}
