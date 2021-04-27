import { useEffect } from 'https://esm.sh/react@17.0.2'
import { recoverCSS, removeCSS } from '../../core/style.ts'

export default function StyleLink({ href }: { href: string }) {
  useEffect(() => {
    recoverCSS(href)
    return () => removeCSS(href, true)
  }, [])

  return null
}
