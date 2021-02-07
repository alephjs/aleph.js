import { LinkHTMLAttributes, useContext, useEffect } from 'https://esm.sh/react'
import util from '../../shared/util.ts'
import { SSRContext } from './context.ts'

export default function Link({
  rel,
  href,
  ...rest
}: LinkHTMLAttributes<{}>) {
  const { __base: baseUrl, __url: url } = rest as any
  const { styleLinks } = useContext(SSRContext)

  if (rel === 'stylesheet' || rel === 'style') {
    if (util.inDeno()) {
      styleLinks.set(url, { module: util.cleanPath(baseUrl + '/' + href) })
    } else {

    }
  }

  useEffect(() => {

  }, [rel, href, url])

  return null
}
