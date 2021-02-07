import { ComponentType, createElement, EmbedHTMLAttributes, Fragment, useEffect, useState } from 'https://esm.sh/react'
import util from '../../shared/util.ts'
import { isLikelyReactComponent } from './helper.ts'

type EmbedProps = EmbedHTMLAttributes<{}> & {
  'data-props'?: any
  'data-export-name'?: string
}

export default function Embed({
  type,
  src,
  children,
  'data-props': props,
  'data-export-name': exportName,
  ...rest
}: EmbedProps) {
  const { __base: baseUrl } = rest as any
  const [error, setError] = useState<string | null>(null)
  const [mod, setMod] = useState<{ Component: ComponentType | null }>({ Component: null })

  useEffect(() => {
    if (type === 'component') {
      setMod({ Component: null })
      import(util.cleanPath('/_aleph/' + (baseUrl || '') + '/' + src))
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
  }, [type, src, exportName, baseUrl])

  if (type !== 'component') {
    return createElement('embed', { ...rest, type, src, children })
  }

  if (error) {
    return createElement('div', { style: { color: 'red' } }, error)
  }

  if (mod.Component) {
    return createElement(mod.Component, props)
  }

  if (children) {
    return createElement(Fragment, { children })
  }

  return null
}
