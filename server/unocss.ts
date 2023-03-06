import { createGenerator, type UnoGenerator, type UserConfig } from "@unocss/core";
import type { AtomicCSSConfig } from "./types.ts";

type UnoConfig = UserConfig & { test?: RegExp; resetCSS?: boolean };

export default function UnoCSS(config: UnoConfig): UnoGenerator & AtomicCSSConfig;
export default function UnoCSS(test: RegExp, config: UnoConfig): UnoGenerator & AtomicCSSConfig;
export default function UnoCSS(
  testOrConfig: RegExp | UnoConfig,
  config?: UnoConfig,
): UnoGenerator & AtomicCSSConfig {
  const test = testOrConfig instanceof RegExp ? testOrConfig : undefined;
  config = testOrConfig instanceof RegExp ? config ?? {} : testOrConfig;
  if (!Array.isArray(config.presets)) {
    throw new Error("UnoCSS: `presets` must be an array.");
  }
  const generator = createGenerator(config);
  if (test) {
    Reflect.set(generator, "test", test);
  }
  if (config.test instanceof RegExp) {
    Reflect.set(generator, "test", config.test);
  }
  if (config.resetCSS !== false) {
    Reflect.set(
      generator,
      "resetCSS",
      `https://esm.sh/@unocss/reset@${generator.version}/tailwind.css`,
    );
  }
  return generator;
}
