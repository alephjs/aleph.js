import type { RouterURL } from '../types.ts'

export interface Module {
    id: string
    loader: string
    url: string
    localUrl: string
    isRemote: boolean
    sourceHash: string
    hash: string
    deps: DependencyDescriptor[]
    jsFile: string
    jsContent: string
    jsSourceMap: string | null
    error: Error | null
}

export interface DependencyDescriptor {
    url: string
    hash: string
    isDynamic?: boolean
    isStyle?: boolean
    isData?: boolean
}

export interface RenderResult {
    url: RouterURL
    status: number
    head: string[]
    scripts: Record<string, any>[]
    body: string
    data: Record<string, string> | null
}

export type ImportMap = Record<string, ReadonlyArray<string>>