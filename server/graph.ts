import { type DependencyDescriptor } from "../compiler/types.d.ts";

export type Module = {
  specifier: string;
  version: number;
  deps: DependencyDescriptor[];
};

export class DependencyGraph {
  #modules = new Map<string, Module>();

  get modules(): Module[] {
    const modules: Module[] = [];
    this.#modules.forEach((module) => {
      modules.push({ ...module, deps: module.deps.map((dep) => ({ ...dep })) });
    });
    return modules;
  }

  has(specifier: string) {
    return this.#modules.has(specifier);
  }

  get(specifier: string): Module | undefined {
    return this.#modules.get(specifier);
  }

  add(module: Module) {
    this.#modules.set(module.specifier, module);
  }

  // version++
  update(specifier: string, deps: DependencyDescriptor[], __tracing = new Set<string>()) {
    const module = this.get(specifier);
    if (module) {
      module.deps = deps;
      module.version++;
      __tracing.add(specifier);
      this.#modules.forEach((module) => {
        if (module.deps.find((dep) => dep.specifier === specifier)) {
          if (!__tracing.has(module.specifier)) {
            this.update(module.specifier, module.deps);
          }
        }
      });
    }
  }

  remove(specifier: string) {
    this.#modules.delete(specifier);
  }
}
