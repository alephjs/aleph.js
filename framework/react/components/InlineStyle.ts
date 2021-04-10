import { StyleHTMLAttributes, useContext, useEffect } from 'react'
import util from '../../../shared/util.ts'
import { applyCSS, removeCSS } from '../../core/style.ts'
import { SSRContext } from '../context.ts'

export default function InlineStyle({ children, ...rest }: StyleHTMLAttributes<{}>) {
  const { inlineStyles } = useContext(SSRContext)
  const { __styleId: id } = rest as any
  const css = children?.toLocaleString()

  if (id && css) {
    if (util.inDeno) {
      inlineStyles.set('#' + id, css)
    } else {
      applyCSS('#' + id, css)
    }
  }

  useEffect(() => () => id && removeCSS('#' + id), [])

  return null
}
