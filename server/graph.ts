import type { DependencyDescriptor } from "../compiler/types.d.ts";

export type Module = {
  specifier: string;
  version: number;
  deps?: DependencyDescriptor[];
  inlineCSS?: boolean;
};

export class DependencyGraph {
  #modules = new Map<string, Module>();

  get modules(): Module[] {
    const modules: Module[] = [];
    this.#modules.forEach((module) => {
      modules.push({ ...module, deps: module.deps?.map((dep) => ({ ...dep })) });
    });
    return modules;
  }

  get(specifier: string): Module | undefined {
    return this.#modules.get(specifier);
  }

  mark(module: Module) {
    const prev = this.#modules.get(module.specifier);
    if (prev) {
      prev.deps = module.deps;
      prev.inlineCSS = module.inlineCSS;
    } else {
      this.#modules.set(module.specifier, module);
    }
  }

  unmark(specifier: string) {
    this.#modules.delete(specifier);
  }

  // version++
  update(specifier: string) {
    this.#update(specifier);
  }

  #update(specifier: string, __tracing = new Set<string>()) {
    const module = this.get(specifier);
    if (module) {
      module.version++;
      __tracing.add(specifier);
      this.#modules.forEach((module) => {
        if (module.deps?.find((dep) => dep.specifier === specifier)) {
          if (!__tracing.has(module.specifier)) {
            this.#update(module.specifier, __tracing);
          }
        }
      });
    }
  }

  lookup(specifier: string, callback: (specifier: string) => void | false) {
    this.#lookup(specifier, callback);
  }

  #lookup(specifier: string, callback: (specifier: string) => void | false, __tracing = new Set<string>()) {
    __tracing.add(specifier);
    for (const module of this.#modules.values()) {
      if (module.deps?.find((dep) => dep.specifier === specifier)) {
        if (!__tracing.has(module.specifier) && callback(module.specifier) !== false) {
          this.#lookup(module.specifier, callback, __tracing);
        }
      }
    }
  }
}
