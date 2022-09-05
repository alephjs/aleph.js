// deno std
export { concat as concatBytes } from "https://deno.land/std@0.145.0/bytes/mod.ts";
export { blue, bold, cyan, dim, green, red, yellow } from "https://deno.land/std@0.145.0/fmt/colors.ts";
export { ensureDir } from "https://deno.land/std@0.145.0/fs/ensure_dir.ts";
export { serve, serveTls } from "https://deno.land/std@0.145.0/http/server.ts";
export { encode as btoa } from "https://deno.land/std@0.145.0/encoding/base64.ts";
export {
  basename,
  dirname,
  extname,
  fromFileUrl,
  globToRegExp,
  join,
  relative,
  resolve,
} from "https://deno.land/std@0.145.0/path/mod.ts";

// third-party
// @deno-types="https://deno.land/x/esbuild@v0.14.49/mod.d.ts"
export { build as esbuild, type BuildResult, stop as stopEsbuild } from "https://deno.land/x/esbuild@v0.15.7/mod.js";
export * from "https://deno.land/x/aleph_compiler@0.7.6/mod.ts";
export * from "https://deno.land/x/aleph_compiler@0.7.6/types.ts";
export { default as initLolHtml, HTMLRewriter } from "https://deno.land/x/lol_html@0.0.4/mod.js";
export { default as lolHtmlWasm } from "https://deno.land/x/lol_html@0.0.4/wasm.js";
export { JSONC } from "https://deno.land/x/jsonc_parser@v0.0.1/src/jsonc.ts";

// npm
export { default as mitt, type Emitter } from "https://esm.sh/mitt@3.0.0";
export { default as MagicString } from "https://esm.sh/magic-string@0.26.3?target=esnext";
