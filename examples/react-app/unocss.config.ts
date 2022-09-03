import type { UserConfig } from "@unocss/core.ts";
import presetWind from "@unocss/preset-wind.ts";

// @ref https://github.com/unocss/unocss#configurations
export default <UserConfig> {
  presets: [presetWind()],
};
