import type { ModuleLoader, ModuleLoaderEnv, ModuleLoaderOutput } from "../../server/types.ts";
import { compile } from "https://esm.sh/@mdx-js/mdx@2.1.3?no-dts";

export type Options = {
  /** Place to import automatic JSX runtimes from (default use the option in `deno.json`). */
  jsxImportSource?: string;
  /** Options to pass through to remark-rehype. The option allowDangerousHtml will always be set to true and the MDX nodes are passed through. */
  remarkPlugins?: unknown[];
  /** List of remark plugins, presets, and pairs. */
  rehypePlugins?: unknown[];
  /** List of recma plugins. This is a new ecosystem, currently in beta, to transform esast trees (JavaScript). */
  recmaPlugins?: unknown[];
};

export default class MDXLoader implements ModuleLoader {
  #options: Options;

  constructor(options?: Options) {
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
        development: env.isDev,
        ...this.#options,
      },
    );
    return {
      code: ret.toString(),
      lang: "js",
    };
  }
}
