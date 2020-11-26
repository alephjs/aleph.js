import React, { ComponentType, LinkHTMLAttributes, useEffect, useState } from 'https://esm.sh/react'
import util from './util.ts'

type LinkProps = LinkHTMLAttributes<{}> & {
    ['data-fallback']?: JSX.Element
    ['data-props']?: any
    ['data-export-name']?: string
    __baseUrl?: string
}

export default function Link({
    rel,
    href,
    ['data-fallback']: fallback,
    ['data-props']: compProps,
    ['data-export-name']: exportName,
    __baseUrl
}: LinkProps) {
    const [error, setError] = useState<string | null>(null)
    const [mod, setMod] = useState<{ Component: ComponentType | null }>({ Component: null })

    useEffect(() => {
        if (rel === "component") {
            setMod({ Component: null })
            import(util.cleanPath((__baseUrl || '/') + '/_aleph/' + href))
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
        }
    }, [rel, href, exportName, __baseUrl])

    if (error) {
        return React.createElement('div', { style: { color: 'red' } }, error)
    }

    if (mod.Component) {
        return React.createElement(mod.Component, compProps)
    }

    if (rel === "component" && fallback) {
        return fallback
    }

    return null
}
