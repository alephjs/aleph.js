import type { ModuleLoader, ModuleLoaderEnv, ModuleLoaderOutput } from "../../server/types.ts";
import { compile, type CompileOptions } from "https://esm.sh/@mdx-js/mdx@2.3.0";

export default class MDXLoader implements ModuleLoader {
  #options: CompileOptions;

  constructor(options?: CompileOptions) {
    this.#options = options ?? {};
  }

  test(path: string): boolean {
    return path.endsWith(".mdx") || path.endsWith(".md") || path.endsWith(".markdown");
  }

  async load(specifier: string, content: string, env: ModuleLoaderEnv): Promise<ModuleLoaderOutput> {
    const ret = await compile(
      { path: specifier, value: content },
      {
        jsxImportSource: this.#options.jsxImportSource ?? env.jsxConfig?.jsxImportSource ?? "https://esm.sh/react@18",
        ...this.#options,
        providerImportSource: this.#options.providerImportSource
          ? env.importMap?.imports[this.#options.providerImportSource] ?? this.#options.providerImportSource
          : undefined,
        development: env.isDev,
      },
    );
    return {
      code: ret.toString(),
      lang: "js",
    };
  }
}
