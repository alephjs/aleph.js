import { useEffect } from 'https://esm.sh/react'
import { recoverCSS, removeCSS } from '../core/style.ts'

export default function StyleLink({ href }: { href: string }) {
  useEffect(() => {
    recoverCSS(href)
    return () => removeCSS(href, true)
  }, [])

  return null
}
