import { useEffect } from 'https://esm.sh/react'
import util from '../../shared/util.ts'
import { recoverCSS, removeCSS } from '../core/style.ts'

export default function StyleLink({ href }: { href: string }) {
  useEffect(() => () => {
    recoverCSS(href)
    if (util.isNEString(href)) {
      removeCSS(href, true)
    }
  }, [])

  return null
}
