import { createGenerator, type UserConfig } from "@unocss/core";
import type { AtomicCSSEngine, Plugin } from "../server/types.ts";

export type UnoConfig = UserConfig & { test?: RegExp; resetCSS?: boolean };

export function UnoCSS(config?: UnoConfig): AtomicCSSEngine {
  if (!Array.isArray(config?.presets)) {
    throw new Error("UnoCSS: `presets` must be an array.");
  }
  const generator = createGenerator(config);
  if (config?.test) {
    Reflect.set(generator, "test", config?.test);
  }
  if (config?.test instanceof RegExp) {
    Reflect.set(generator, "test", config.test);
  }
  if (config?.resetCSS !== false) {
    Reflect.set(
      generator,
      "resetCSS",
      `https://esm.sh/@unocss/reset@${generator.version}/tailwind.css`,
    );
  }
  Reflect.set(generator, "name", "UnoCSS");
  return generator;
}

export default function UnoCSSPlugin(config: UnoConfig): Plugin;
export default function UnoCSSPlugin(test: RegExp, config: UnoConfig): Plugin;
export default function UnoCSSPlugin(testOrConfig: RegExp | UnoConfig, config?: UnoConfig): Plugin {
  return {
    name: "unocss",
    setup(aleph) {
      const isRegexp = testOrConfig instanceof RegExp;
      config = isRegexp ? config ?? {} : testOrConfig;
      if (isRegexp) {
        config.test = testOrConfig;
      }
      aleph.atomicCSS = UnoCSS(config);
    },
  };
}
