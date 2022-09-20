import type { ModuleLoader, ModuleLoaderEnv, ModuleLoaderOutput } from "../../server/types.ts";
import { compile } from "https://esm.sh/@mdx-js/mdx@2.1.3?no-dts";

export type Options = {
  jsxImportSource?: string;
  remarkPlugins?: unknown[];
  rehypePlugins?: unknown[];
};

export default class SolidTransformer implements ModuleLoader {
  #options: Options;

  constructor(options?: Options) {
    this.#options = options ?? {};
  }

  test(path: string): boolean {
    return path.endsWith(".mdx") || path.endsWith(".md") || path.endsWith(".markdown");
  }

  async load(_specifier: string, content: string, env: ModuleLoaderEnv): Promise<ModuleLoaderOutput> {
    const ret = await compile(content, {
      jsxImportSource: env.jsxConfig?.jsxImportSource ?? "https://esm.sh/react@18",
      ...this.#options,
    });
    return {
      code: ret.toString(),
      lang: "js",
    };
  }
}
