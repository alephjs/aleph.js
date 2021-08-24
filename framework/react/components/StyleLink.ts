import { useEffect, useLayoutEffect } from 'https://esm.sh/react@17.0.2'
import { recoverCSS, removeCSS } from '../../core/style.ts'
import { inDeno } from '../helper.ts'

const useIsomorphicLayoutEffect = inDeno ? useEffect : useLayoutEffect

export default function StyleLink({ href }: { href: string }) {
  if (!inDeno) {
    recoverCSS(href)
  }

  useIsomorphicLayoutEffect(() => {
    return () => removeCSS(href, true)
  }, [])

  return null
}
