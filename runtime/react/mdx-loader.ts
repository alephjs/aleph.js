import type { ModuleLoader, ModuleLoaderEnv, ModuleLoaderOutput } from "../../server/types.ts";
import { compile } from "https://esm.sh/@mdx-js/mdx@2.1.3?no-dts";

export default class SolidTransformer implements ModuleLoader {
  test(path: string): boolean {
    return path.endsWith(".mdx");
  }

  async load(_specifier: string, content: string, env: ModuleLoaderEnv): Promise<ModuleLoaderOutput> {
    const ret = await compile(content, {
      jsxImportSource: env.importMap?.imports["react"] ?? "https://esm.sh/react@18",
    });
    return {
      code: ret.toString(),
      lang: "js",
    };
  }
}
