import { transform } from "https://esm.sh/@babel/standalone@7.19.2";
import babelPresetSolid from "https://esm.sh/babel-preset-solid@1.5.5";
import solidRefresh from "https://esm.sh/solid-refresh@0.4.1/babel";
import type { ModuleLoader, ModuleLoaderEnv, ModuleLoaderOutput } from "../../server/types.ts";

export default class SolidTransformer implements ModuleLoader {
  test(path: string): boolean {
    return path.endsWith(".tsx") || path.endsWith(".jsx");
  }

  load(specifier: string, content: string, env: ModuleLoaderEnv): ModuleLoaderOutput {
    const { code, map } = transform(content, {
      presets: [
        [babelPresetSolid, { generate: env.ssr ? "ssr" : "dom", hydratable: env.ssr || !env.spaMode }],
        ["typescript", { onlyRemoveTypeImports: true }],
      ],
      plugins: env.isDev && !env.ssr ? [[solidRefresh, { bundler: "vite" }]] : [],
      filename: specifier,
    });
    return {
      code: code ?? "",
      lang: "js",
      map: map ? JSON.stringify(map) : undefined,
    };
  }
}
