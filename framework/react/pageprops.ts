import type { ComponentType } from 'https://esm.sh/react'
import { RouterURL } from '../../types.ts'
import { toPagePath } from '../core/routing.ts'
import { E400MissingComponent } from './error.ts'
import { isLikelyReactComponent } from './util.ts'

export type PageProps = {
  Page: ComponentType<any> | null
  pageProps: (Partial<PageProps> & { name?: string }) | null
}

export type PageRoute = PageProps & {
  url: RouterURL
}

export function createPageProps(componentChain: { url: string, Component?: ComponentType<any> }[]): PageProps {
  const pageProps: PageProps = {
    Page: null,
    pageProps: null
  }
  if (componentChain.length > 0) {
    Object.assign(pageProps, createPagePropsSegment(componentChain[0]))
  }
  if (componentChain.length > 1) {
    componentChain.slice(1).reduce((p, seg) => {
      const c = createPagePropsSegment(seg)
      p.pageProps = c
      return c
    }, pageProps)
  }
  return pageProps
}

function createPagePropsSegment(seg: { url: string, Component?: ComponentType<any> }): PageProps {
  const pageProps: PageProps = {
    Page: null,
    pageProps: null
  }
  if (seg.Component) {
    if (isLikelyReactComponent(seg.Component)) {
      pageProps.Page = seg.Component
    } else {
      pageProps.Page = E400MissingComponent
      pageProps.pageProps = { name: 'Page: ' + toPagePath(seg.url) }
    }
  }
  return pageProps
}
