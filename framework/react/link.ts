import { LinkHTMLAttributes, useContext, useEffect, useRef } from 'https://esm.sh/react'
import util from '../../shared/util.ts'
import { SSRContext } from './context.ts'

export default function Link({
  rel,
  href,
  ...rest
}: LinkHTMLAttributes<{}>) {
  const { __base: baseUrl, __url: url } = rest as any
  const { styleLinks } = useContext(SSRContext)
  const onceRef = useRef(true)

  if (rel === 'stylesheet' || rel === 'style') {
    if (util.inDeno()) {
      styleLinks.set(url, { module: util.cleanPath(baseUrl + '/' + href) })
    } else if (onceRef.current) {
      const { document } = window as any
      const prevEl = Array.from<any>(document.head.children).find((el: any) => {
        return el.getAttribute('data-module-id') === url
      })
      if (!prevEl) {

      } else if (prevEl.hasAttribute('ssr')) {
        import(util.cleanPath(`/_aleph/${baseUrl}/${href}`))
      }
      onceRef.current = false
    }
  }

  useEffect(() => {

  }, [rel, href, url])

  return null
}
