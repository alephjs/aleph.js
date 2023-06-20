/** @format */

import { compile, type CompileOptions } from "https://esm.sh/v126/@mdx-js/mdx@2.3.0";
import type { ModuleLoader, ModuleLoaderEnv, ModuleLoaderOutput, Plugin } from "../server/types.ts";

export class MDXLoader implements ModuleLoader {
  #options: CompileOptions;

  constructor(options?: CompileOptions) {
    this.#options = options ?? {};
  }

  test(path: string): boolean {
    const exts = this.#options?.mdxExtensions ?? ["mdx"];
    return exts.some((ext) => path.endsWith(`.${ext}`));
  }

  async load(
    specifier: string,
    content: string,
    env: ModuleLoaderEnv,
  ): Promise<ModuleLoaderOutput> {
    const ret = await compile(
      { path: specifier, value: content },
      {
        jsxImportSource: this.#options.jsxImportSource ??
          env.jsxConfig?.jsxImportSource,
        ...this.#options,
        providerImportSource: this.#options.providerImportSource
          ? env.importMap?.imports[
            this.#options.providerImportSource
          ] ?? this.#options.providerImportSource
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

export default function MdxPlugin(options?: CompileOptions): Plugin {
  return {
    name: "mdx",
    setup(aleph) {
      const exts = options?.mdxExtensions ?? ["mdx"];
      aleph.loaders = [new MDXLoader(options), ...(aleph.loaders ?? [])];
      aleph.router = {
        ...aleph.router,
        exts: [...exts, ...(aleph.router?.exts ?? [])],
      };
    },
  };
}
