import { createContext, ReactNode } from 'https://esm.sh/react@17.0.2'
import type { RouterURL } from '../../types.d.ts'
import { createBlankRouterURL } from '../core/routing.ts'
import { createNamedContext } from './helper.ts'
import type { RendererStore } from './renderer.ts'

export const RouterContext = createNamedContext<RouterURL>(createBlankRouterURL(), 'RouterContext')
export const FallbackContext = createNamedContext<{ to: ReactNode }>({ to: null }, 'FallbackContext')
export const SSRContext = createContext<RendererStore>({
  headElements: new Map(),
  inlineStyles: new Map(),
  scripts: new Map(),
})
