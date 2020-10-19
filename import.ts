import React, { ComponentType, ReactElement, useEffect, useState } from 'https://esm.sh/react'
import util, { reModuleExt } from './util.ts'

interface ImportProps {
    from: string
    name?: string // default is 'default'
    props?: Record<string, any>
    fallback?: ReactElement
}

export default function Import(props: ImportProps) {
    const { __importer, __sourceFile } = (props as any)
    const [error, setError] = useState<string | null>(null)
    const [mod, setMod] = useState<{ Component: ComponentType | null }>({ Component: null })

    useEffect(() => {
        if (reModuleExt.test(__sourceFile)) {
            const p = util.splitPath(__importer)
            p.pop()
            import(util.cleanPath('/_aleph/' + p.join('/') + '/' + props.from))
                .then(mod => {
                    const Component = mod[props.name || 'default']
                    if (util.isLikelyReactComponent(Component)) {
                        setMod({ Component })
                    } else {
                        setError(`component${props.name ? ` '${props.name}'` : ''} not found`)
                    }
                })
                .catch((err: Error) => {
                    setError(err.message)
                })
        }
    }, [__importer, __sourceFile])

    if (error) {
        return React.createElement('div', { style: { color: 'red' } }, error)
    }

    if (mod.Component) {
        return React.createElement(mod.Component, props.props)
    }

    if (reModuleExt.test(__sourceFile) && props.fallback) {
        return props.fallback
    }

    return null
}
