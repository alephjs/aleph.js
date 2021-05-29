import util from '../shared/util.ts'
import type { Application, Module } from './app.ts'
import { getAlephPkgUri } from './helper.ts'

export type DependencyGraph = {
  specifier: string
  size: number
  isShared?: boolean
  isDynamic?: boolean
  external?: boolean
  deps: DependencyGraph[]
}

export class Analyzer {
  #app: Application
  #entries: DependencyGraph[] = []

  constructor(app: Application) {
    this.#app = app
  }

  get entries() {
    return [...this.#entries]
  }

  reset() {
    const { framework } = this.#app.config
    const bootstrapModuleUrl = `${getAlephPkgUri()}/framework/${framework}/bootstrap.ts`

    this.#entries = [
      this.createDependencyGraph({
        specifier: 'shared:/common',
        deps: [],
      }),
      this.createDependencyGraph({
        specifier: 'shared:/vendor',
        deps: [
          { specifier: bootstrapModuleUrl }
        ],
      }),
    ]

    // app.tsx
    const appMoudle = this.#app.getModule('app')
    if (appMoudle) {
      this.#entries.push(this.createDependencyGraph(appMoudle))
    }

    // main.js
    this.#entries.push(Object.assign(this.createDependencyGraph({
      specifier: '/main.js',
      deps: [
        { specifier: bootstrapModuleUrl }
      ],
    }), { size: this.#app.createMainJS(true).length }))
  }

  addEntry(
    module: Pick<Module, 'specifier' | 'deps' | 'external'>,
    extraDeps?: string[],
  ) {
    this.#entries.push(this.createDependencyGraph(
      module,
      undefined,
      undefined,
      extraDeps,
    ))
  }

  private createDependencyGraph(
    module: Pick<Module, 'specifier' | 'deps' | 'external'>,
    isDynamic?: boolean,
    isShared?: boolean,
    extraDeps?: string[],
    __tracing = new Set<string>()
  ): DependencyGraph {
    const { specifier, deps, external } = module
    const graph: DependencyGraph = {
      specifier,
      size: -1,
      isDynamic,
      isShared,
      external,
      deps: []
    }

    if (isDynamic && !external && this.#entries.findIndex(c => specifier === c.specifier) === -1) {
      this.#entries.push(this.createDependencyGraph(module, undefined, isShared))
    }

    if (!isDynamic && !isShared && !external) {
      graph.deps = [
        ...deps,
        ...extraDeps?.map(specifier => ({ specifier, isDynamic: false })) || []
      ]
        .filter(({ specifier }) => this.#app.getModule(specifier) !== null)
        .map(({ specifier, isDynamic }) => {
          const depMod = this.#app.getModule(specifier)!
          const isRemote = util.isLikelyHttpURL(depMod.specifier)
          let isGlobalShared = false

          // 1. check the dep whether it is global shared
          const sharedGraph = this.#entries.find(({ specifier }) => {
            return specifier === (isRemote ? 'shared:/vendor' : 'shared:/common')
          })!
          for (const graph of sharedGraph.deps) {
            isGlobalShared = graph.specifier === module.specifier
            if (!isGlobalShared) {
              Analyzer.walkDependencyGraph(graph, graph => {
                isGlobalShared = graph.specifier === module.specifier
                if (isGlobalShared) {
                  return false // break walking
                }
              })
            }
            if (isGlobalShared) {
              break
            }
          }

          return this.createDependencyGraph(depMod, isDynamic, isShared, undefined, __tracing)
        })
    }

    return graph
  }

  static walkDependencyGraph(
    graph: DependencyGraph,
    callback: (graph: DependencyGraph) => false | void,
    __tracing: Set<string> = new Set()
  ) {
    if (__tracing.has(graph.specifier)) {
      return
    }
    __tracing.add(graph.specifier)
    for (const dep of graph.deps) {
      if (callback(dep) === false) {
        return false
      }
      if ((Analyzer.walkDependencyGraph(dep, callback, __tracing)) === false) {
        return false
      }
    }
  }
}
