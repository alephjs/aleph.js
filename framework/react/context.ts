import { createContext, ReactNode } from 'https://esm.sh/react@17.0.2'
import type { RouterURL } from '../../types.ts'
import { createBlankRouterURL } from '../core/routing.ts'
import { createNamedContext } from './helper.ts'
import type { RendererStorage } from './renderer.ts'

export const RouterContext = createNamedContext<RouterURL>(createBlankRouterURL(), 'RouterContext')

export const SSRContext = createContext<RendererStorage>({
  headElements: new Map(),
  scripts: new Map(),
  inlineStyles: new Map(),
})

export const FallbackContext = createContext<{ to: ReactNode }>({
  to: null
})
