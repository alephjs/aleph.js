import { transform } from "https://esm.sh/@babel/standalone@7.18.9";
import babelPresetSolid from "https://esm.sh/babel-preset-solid@1.5.1";
import type { ModuleLoader, ModuleLoaderEnv, ModuleLoaderOutput } from "../server/types.ts";

export default class SolidLoader implements ModuleLoader {
  test(path: string): boolean {
    return path.endsWith(".js") || path.endsWith(".jsx") || path.endsWith(".tsx");
  }

  load(specifier: string, content: string, env: ModuleLoaderEnv): ModuleLoaderOutput {
    const { code, map } = transform(content, {
      presets: [
        [babelPresetSolid, { generate: env.ssr ? "ssr" : "dom", hydratable: env.ssr || !env.spaMode }],
        ["typescript", { onlyRemoveTypeImports: true }],
      ],
      filename: specifier,
    });
    return {
      code: code ?? "",
      lang: "js",
      map: map ? JSON.stringify(map) : undefined,
    };
  }
}
