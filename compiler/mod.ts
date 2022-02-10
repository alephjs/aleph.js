import { join } from "https://deno.land/std@0.125.0/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.125.0/fs/ensure_dir.ts";
import { existsFile } from "../lib/fs.ts";
import { Measure } from "../lib/log.ts";
import { getDenoDir } from "../lib/cache.ts";
import { checksum } from "./dist/checksum.js";
import init, { transformSync } from "./dist/compiler.js";

export type ImportMap = {
  imports: Record<string, string>;
  scopes: Record<string, Record<string, string>>;
};

export type TransformOptions = {
  alephPkgUri?: string;
  importMap?: ImportMap;
  isDev?: boolean;
  jsx?: string;
  jsx_import_source?: string;
};

export type TransformResult = {
  code: string;
  deps?: RawDependencyDescriptor[];
  jsxStaticClassNames?: string[];
  map?: string;
};

type RawDependencyDescriptor = {
  specifier: string;
  resolved: string;
  isDynamic: boolean;
};

let wasmReady: Promise<void> | boolean = false;

async function initWasm() {
  const cacheDir = join(await getDenoDir(), `deps/https/deno.land/aleph`);
  const cachePath = `${cacheDir}/compiler.${checksum}.wasm`;
  if (await existsFile(cachePath)) {
    const wasmData = await Deno.readFile(cachePath);
    await init(wasmData);
  } else {
    const { default: getWasmData } = await import("./dist/wasm.js");
    const wasmData = getWasmData();
    await init(wasmData);
    await ensureDir(cacheDir);
    await Deno.writeFile(cachePath, wasmData);
  }
}

async function checkWasmReady() {
  let ms: Measure | null = null;
  if (wasmReady === false) {
    ms = new Measure();
    wasmReady = initWasm();
  }
  if (wasmReady instanceof Promise) {
    await wasmReady;
    wasmReady = true;
  }
  if (ms !== null) {
    ms.stop("init compiler wasm");
  }
}

/**
 * Transforms the module with esbuild/swc.
 *
 * ```tsx
 * transform(
 *   '/app.tsx',
 *   `
 *    import React from 'https://esm.sh/react';
 *
 *    export default App() {
 *      return <h1>Hello World</h1>
 *    }
 *   `
 * )
 * ```
 */
export async function transform(
  specifier: string,
  code: string,
  options: TransformOptions = {},
): Promise<TransformResult> {
  await checkWasmReady();

  return transformSync(
    specifier,
    code,
    options,
  );
}

/**
 * The wasm checksum.
 */
export const wasmChecksum = checksum;
