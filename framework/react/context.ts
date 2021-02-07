import { createContext } from 'https://esm.sh/react'
import type { RouterURL } from '../../types.ts'
import { createNamedContext } from './helper.ts'

export const RouterContext = createNamedContext<RouterURL>({
  locale: 'en',
  pagePath: '/',
  pathname: '/',
  params: {},
  query: new URLSearchParams(),
}, 'RouterContext')

type SSRContextProps = {
  styleLinks: Map<string, { module: string }>
  headElements: Map<string, { type: string, props: Record<string, any> }>
  scriptElements: Map<string, { props: Record<string, any> }>
}

export const SSRContext = createContext<SSRContextProps>({
  styleLinks: new Map(),
  headElements: new Map(),
  scriptElements: new Map()
})
