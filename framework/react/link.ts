import type { ComponentType, LinkHTMLAttributes } from 'https://esm.sh/react'
import { createElement, useEffect, useState } from 'https://esm.sh/react'
import util from '../../shared/util.ts'
import { isLikelyReactComponent } from './util.ts'

type LinkProps = LinkHTMLAttributes<{}> & {
  'data-fallback'?: JSX.Element
  'data-props'?: any
  'data-export-name'?: string
}

export default function Link({
  rel,
  href,
  'data-fallback': fallback,
  'data-props': props,
  'data-export-name': exportName,
  ...rest
}: LinkProps) {
  const { __base: baseUrl } = rest as any
  const [error, setError] = useState<string | null>(null)
  const [mod, setMod] = useState<{ Component: ComponentType | null }>({ Component: null })

  useEffect(() => {
    if (rel === 'component') {
      setMod({ Component: null })
      import(util.cleanPath('/_aleph/' + (baseUrl || '') + '/' + href))
        .then(mod => {
          const Component = mod[exportName || 'default']
          if (isLikelyReactComponent(Component)) {
            setMod({ Component })
          } else {
            setError(`component${exportName ? ` '${exportName}'` : ''} not found`)
          }
        })
        .catch((err: Error) => setError(err.message))
    }
  }, [rel, href, exportName, baseUrl])

  if (error) {
    return createElement('div', { style: { color: 'red' } }, error)
  }

  if (mod.Component) {
    return createElement(mod.Component, props)
  }

  if (rel === 'component' && fallback) {
    return fallback
  }

  return null
}
