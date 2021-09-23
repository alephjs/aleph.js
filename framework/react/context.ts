import type { RouterURL } from '../../types.d.ts'
import type { RendererStore } from './renderer.ts'
import { createContext, ReactNode } from 'https://esm.sh/react@17.0.2'
import { createBlankRouterURL } from '../core/routing.ts'
import { createNamedContext } from './helper.ts'

export const RouterContext = createNamedContext<RouterURL>(createBlankRouterURL(), 'RouterContext')
export const FallbackContext = createNamedContext<{ to: ReactNode }>({ to: null }, 'FallbackContext')
export const SSRContext = createContext<RendererStore>({
  request: new Request('http://localhost/'),
  dataCache: {},
  headElements: new Map(),
  inlineStyles: new Map(),
  scripts: new Map(),
})
