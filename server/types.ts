import type { RouterURL } from '../types.ts'

/**
 * A module includes compilation details.
 */
export type Module = {
  url: string
  hash: string
  sourceHash: string
  deps: DependencyDescriptor[]
  jsFile: string
}

/**
 * The dependency descriptor.
 */
export type DependencyDescriptor = {
  url: string
  hash: string
  isDynamic?: boolean
}

/**
 * The render result of SSR.
 */
export type RenderResult = {
  url: RouterURL
  status: number
  head: string[]
  body: string
  scripts: Record<string, any>[]
  data: Record<string, string> | null
}
