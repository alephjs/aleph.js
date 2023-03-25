import { transform } from "https://esm.sh/v110/@babel/standalone@7.21.3";
import babelPresetSolid from "https://esm.sh/v110/babel-preset-solid@1.6.12";
// import solidRefresh from "https://esm.sh/v110/solid-refresh@0.5.1/babel";
import type { ModuleLoader, ModuleLoaderEnv, ModuleLoaderOutput } from "../../server/types.ts";

export default class SolidTransformer implements ModuleLoader {
  test(path: string): boolean {
    return path.endsWith(".tsx") || path.endsWith(".jsx");
  }

  load(specifier: string, content: string, env: ModuleLoaderEnv): ModuleLoaderOutput {
    const ret = transform(content, {
      presets: [
        [babelPresetSolid, { generate: env.ssr ? "ssr" : "dom", hydratable: env.ssr || !env.spaMode }],
        ["typescript", { isTSX: true, allExtensions: true }],
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
