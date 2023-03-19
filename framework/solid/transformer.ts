import { transformAsync } from "https://esm.sh/@babel/core@7.21.3?pin=v110";
import babelPresetSolid from "https://esm.sh/babel-preset-solid@1.6.12?pin=v110";
// import solidRefresh from "https://esm.sh/solid-refresh@0.5.1/babel?pin=v110";
import { esbuild } from "../../server/deps.ts";
import type { ModuleLoader, ModuleLoaderEnv, ModuleLoaderOutput } from "../../server/types.ts";

export default class SolidTransformer implements ModuleLoader {
  test(path: string): boolean {
    return path.endsWith(".tsx") || path.endsWith(".jsx");
  }

  async load(specifier: string, content: string, env: ModuleLoaderEnv): Promise<ModuleLoaderOutput> {
    const isTs = specifier.endsWith(".tsx") || specifier.includes(".tsx?");
    if (isTs) {
      // use esbuild to strip typescript syntax
      const ret = await esbuild.transform(content, {
        loader: "tsx",
        format: "esm",
        target: "esnext",
        minify: false,
        jsx: "preserve",
        sourcefile: specifier,
      });
      content = ret.code;
    }
    const ret = await transformAsync(content, {
      presets: [
        [babelPresetSolid, { generate: env.ssr ? "ssr" : "dom", hydratable: env.ssr || !env.spaMode }],
      ],
      // plugins: env.isDev && !env.ssr ? [[solidRefresh, { bundler: "vite" }]] : [],
      filename: specifier,
    });
    if (!ret) {
      throw new Error("failed to transform");
    }
    return {
      code: ret.code ?? "",
      lang: "js",
      map: ret.map ? JSON.stringify(ret.map) : undefined,
    };
  }
}
