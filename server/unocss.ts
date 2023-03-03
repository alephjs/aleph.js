import { createGenerator, type UnoGenerator, type UserConfig } from "@unocss/core";
import type { AtomicCSSConfig } from "./types.ts";

type UnoConfig = UserConfig & AtomicCSSConfig;

export default function unocss(config: UnoConfig): UnoGenerator & AtomicCSSConfig;
export default function unocss(test: RegExp, config: UnoConfig): UnoGenerator & AtomicCSSConfig;
export default function unocss(
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
  if (config.test) {
    Reflect.set(generator, "test", config.test);
  }
  Reflect.set(
    generator,
    "resetCSS",
    `https://esm.sh/@unocss/reset@${generator.version}/${config.resetCSS ?? "tailwind"}.css`,
  );
  return generator;
}
