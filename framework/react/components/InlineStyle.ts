import { StyleHTMLAttributes, useContext, useEffect, useLayoutEffect } from 'https://esm.sh/react@17.0.2'
import { applyCSS, removeCSS } from '../../core/style.ts'
import { SSRContext } from '../context.ts'
import { inDeno } from '../helper.ts'

const useIsomorphicLayoutEffect = inDeno ? useEffect : useLayoutEffect

export default function InlineStyle({ children, ...rest }: StyleHTMLAttributes<{}>) {
  const { inlineStyles } = useContext(SSRContext)
  const { __styleId: id } = rest as any
  const css = children?.toString()

  if (id && css) {
    if (inDeno) {
      inlineStyles.set('#' + id, css)
    } else {
      applyCSS('#' + id, { css })
    }
  }

  useIsomorphicLayoutEffect(() => () => id && removeCSS('#' + id), [])

  return null
}
