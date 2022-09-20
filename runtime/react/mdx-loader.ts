import type { ModuleLoader, ModuleLoaderEnv, ModuleLoaderOutput } from "../../server/types.ts";
import { compile } from "https://esm.sh/@mdx-js/mdx@2.1.3?no-dts";
import remarkFrontmatter from "https://esm.sh/remark-frontmatter@4.0.1?no-dts";
import remarkGfm from "https://esm.sh/remark-gfm@3.0.1?no-dts";

export default class SolidTransformer implements ModuleLoader {
  test(path: string): boolean {
    return path.endsWith(".mdx") || path.endsWith(".md") || path.endsWith(".markdown");
  }

  async load(_specifier: string, content: string, env: ModuleLoaderEnv): Promise<ModuleLoaderOutput> {
    const ret = await compile(content, {
      jsxImportSource: env.importMap?.imports["react"] ?? "https://esm.sh/react@18",
      remarkPlugins: [remarkFrontmatter, remarkGfm],
    });
    return {
      code: ret.toString(),
      lang: "js",
    };
  }
}
