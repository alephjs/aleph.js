import presetWind from "@unocss/preset-wind.ts";
import type { UserConfig } from "@unocss/core.ts";

// @ref https://github.com/unocss/unocss#configurations
export default <UserConfig> {
  presets: [presetWind()],
};
