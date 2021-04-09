import { StyleHTMLAttributes, useEffect } from 'react'
import { applyCSS, removeCSS } from '../core/style.ts'

export default function Style({ children, ...rest }: StyleHTMLAttributes<{}>) {
  const { __styleId: id } = rest as any
  const css = children?.toLocaleString()

  if (id && css) {
    applyCSS('#' + id, css)
  }

  useEffect(() => () => id && removeCSS('#' + id), [])

  return null
}
