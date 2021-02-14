import type { LinkHTMLAttributes } from 'https://esm.sh/react'
import { useContext, useEffect, useMemo } from 'https://esm.sh/react'
import util from '../../shared/util.ts'
import { removeCSS } from '../core/style.ts'
import { RouterContext, SSRContext } from './context.ts'
import { importModule } from './helper.ts'

const reHashJs = /\.([0-9a-fx]{9})\.js$/i

export default function Link({ href, rel, ...rest }: LinkHTMLAttributes<{}>) {
  const { __module: module } = rest as any
  const { styleLinks } = useContext(SSRContext)
  const { baseURL } = useContext(RouterContext)
  const isStyle = useMemo(() => rel === 'stylesheet' || rel === 'style', [rel])

  if (isStyle && util.isNEString(href) && util.isNEString(module)) {
    if (util.inDeno()) {
      styleLinks.set(href, { module })
    } else {
      const { document } = window as any
      const prevEl = Array.from<any>(document.head.children).find((el: any) => {
        return el.getAttribute('data-module-id') === href
      })
      if (reHashJs.test(module)) {
        let hash = ''
        module.replace(reHashJs, (_: string, h: string) => hash = h)
        if (!prevEl) {
          throw importModule(baseURL, { url: href, hash })
        } else if (prevEl.hasAttribute('ssr')) {
          importModule(baseURL, { url: href, hash })
        }
      }
    }
  }

  useEffect(() => () => {
    if (isStyle && util.isNEString(href)) {
      removeCSS(href)
    }
  }, [isStyle, href])

  return null
}
