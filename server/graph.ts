export type Module = {
  readonly specifier: string;
  readonly version: number;
  readonly deps?: ReadonlyArray<DependencyDescriptor>;
  readonly inlineCSS?: string;
  readonly atomicCSS?: {
    readonly tokens: ReadonlyArray<string>;
  };
};

export type DependencyDescriptor = {
  readonly specifier: string;
  readonly dynamic?: boolean;
};

export class DependencyGraph {
  #modules = new Map<string, Module>();
  #globalVersion = Date.now();

  constructor(modules?: Module[], globalVersion?: number) {
    if (modules) {
      modules.forEach((item) => {
        if (typeof item.specifier === "string" && typeof item.version === "number") {
          this.#modules.set(item.specifier, item);
        }
      });
    }
    if (globalVersion) {
      this.#globalVersion = globalVersion;
    }
  }

  get globalVersion(): number {
    return this.#globalVersion;
  }

  get modules(): Module[] {
    const modules: Module[] = [];
    this.#modules.forEach((module) => modules.push(module));
    return modules;
  }

  get(specifier: string): Module | undefined {
    return this.#modules.get(specifier);
  }

  mark(specifier: string, props: Partial<Module>): Module {
    const prev = this.#modules.get(specifier);
    if (prev) {
      Object.assign(prev, props);
      return prev;
    }

    const mod: Module = {
      specifier,
      version: this.#globalVersion,
      ...props,
    };
    this.#modules.set(specifier, mod);
    return mod;
  }

  unmark(specifier: string) {
    this.#modules.delete(specifier);
  }

  // version++
  update(specifier: string) {
    this.#update(specifier);
  }

  #update(specifier: string, _set = new Set<string>()) {
    const module = this.#modules.get(specifier);
    if (module) {
      // deno-lint-ignore ban-ts-comment
      // @ts-ignore
      module.version++;
      _set.add(specifier);
      this.#modules.forEach((module) => {
        if (module.deps?.find((dep) => dep.specifier === specifier)) {
          if (!_set.has(module.specifier)) {
            this.#update(module.specifier, _set);
          }
        }
      });
    }
  }

  lookup(specifier: string, callback: (specifier: string) => void | false) {
    this.#lookup(specifier, callback);
  }

  #lookup(specifier: string, callback: (specifier: string) => void | false, _set = new Set<string>()) {
    _set.add(specifier);
    for (const module of this.#modules.values()) {
      if (module.deps?.find((dep) => dep.specifier === specifier)) {
        if (!_set.has(module.specifier) && callback(module.specifier) !== false) {
          this.#lookup(module.specifier, callback, _set);
        }
      }
    }
  }

  shallowWalk(specifier: string, callback: (mod: Module) => void) {
    this.#shallowWalk(specifier, callback);
  }

  #shallowWalk(
    specifier: string,
    callback: (mod: Module) => void,
    _set = new Set<string>(),
  ) {
    if (this.#modules.has(specifier)) {
      const mod = this.#modules.get(specifier)!;
      callback(mod);
      _set.add(specifier);
      mod.deps?.forEach((dep) => {
        if (!_set.has(dep.specifier)) {
          this.#shallowWalk(dep.specifier, callback, _set);
        }
      });
    }
  }

  walk(specifier: string, callback: (mod: Module, importer?: Module) => void) {
    this.#walk(specifier, callback);
  }

  #walk(
    specifier: string,
    callback: (mod: Module, importer?: Module) => void,
    importer?: Module,
    _path: string[] = [],
  ) {
    if (this.#modules.has(specifier)) {
      const mod = this.#modules.get(specifier)!;
      callback(mod, importer);
      _path.push(specifier);
      mod.deps?.forEach((dep) => {
        if (!_path.includes(dep.specifier)) {
          this.#walk(dep.specifier, callback, mod, [..._path]);
        }
      });
    }
  }
}
