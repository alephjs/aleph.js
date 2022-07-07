// deno std
export { concat as concatBytes } from "https://deno.land/std@0.145.0/bytes/mod.ts";
export { blue, cyan, dim, green, red } from "https://deno.land/std@0.145.0/fmt/colors.ts";
export { serve, serveTls } from "https://deno.land/std@0.145.0/http/server.ts";
export {
  basename,
  extname,
  fromFileUrl,
  globToRegExp,
  join,
  relative,
  resolve,
} from "https://deno.land/std@0.145.0/path/mod.ts";

// third-party
// @deno-types="https://deno.land/x/esbuild@v0.14.48/mod.d.ts"
export { build as esbuild, type BuildResult } from "https://deno.land/x/esbuild@v0.14.48/mod.js";
export * from "https://deno.land/x/aleph_compiler@0.7.3/mod.ts";
export type { Targets, TransformOptions, TransformResult } from "https://deno.land/x/aleph_compiler@0.7.3/types.ts";
export { default as initLolHtml, HTMLRewriter } from "https://deno.land/x/lol_html@0.0.4/mod.js";
export { default as lolHtmlWasm } from "https://deno.land/x/lol_html@0.0.4/wasm.js";
export { JSONC } from "https://deno.land/x/jsonc_parser@v0.0.1/src/jsonc.ts";

// npm
export { default as mitt, type Emitter } from "https://esm.sh/mitt@3.0.0";
export { default as MagicString } from "https://esm.sh/magic-string@0.26.2?target=esnext";
