import type { RouterURL } from '../types.ts'

/**
 * The ES Import Maps.
 */
export type ImportMap = {
  imports: Record<string, string>
  scopes: Record<string, Record<string, string>>
}

/**
 * A module includes compilation details.
 */
export type Module = {
  url: string
  sourceHash: string
  hash: string
  deps: DependencyDescriptor[]
  jsFile: string
  bundlingFile: string
  error: Error | null
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
