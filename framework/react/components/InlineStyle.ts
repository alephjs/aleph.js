import { StyleHTMLAttributes, useContext, useEffect } from 'https://esm.sh/react@17.0.2'
import { applyCSS, removeCSS } from '../../core/style.ts'
import { SSRContext } from '../context.ts'
import { inDeno } from '../helper.ts'

export default function InlineStyle({ children, ...rest }: StyleHTMLAttributes<{}>) {
  const { inlineStyles } = useContext(SSRContext)
  const { __styleId: id } = rest as any
  const css = children?.toLocaleString()

  if (id && css) {
    if (inDeno) {
      inlineStyles.set('#' + id, css)
    } else {
      applyCSS('#' + id, { css })
    }
  }

  useEffect(() => () => id && removeCSS('#' + id), [])

  return null
}
