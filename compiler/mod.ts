import init, {
  fastTransform as fastSWC,
  parseExportNames as parseExportNamesSWC,
  transform as swc,
  transformCSS as parcelCSS,
} from "./dist/compiler.js";
import decodeWasmData from "./dist/wasm.js";
import {
  FastTransformOptions,
  TransformCSSOptions,
  TransformCSSResult,
  TransformOptions,
  TransformResult,
} from "./types.ts";

let wasmReady: Promise<void> | boolean = false;

async function checkWasmReady() {
  if (wasmReady === false) {
    wasmReady = initWasm();
  }
  if (wasmReady instanceof Promise) {
    await wasmReady;
    wasmReady = true;
  }
}

async function initWasm() {
  const wasmData = decodeWasmData();
  await init(wasmData);
}

/** parse export names */
export async function parseExportNames(
  specifier: string,
  code: string,
): Promise<string[]> {
  await checkWasmReady();
  return parseExportNamesSWC(specifier, code);
}

/** fast transform without transpile code raw syntax */
export async function fastTransform(
  specifier: string,
  code: string,
  options: FastTransformOptions = {},
): Promise<TransformResult> {
  await checkWasmReady();
  return fastSWC(specifier, code, options);
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
 *      return <h1>Hello world!</h1>
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
  return swc(specifier, code, options);
}

/**
 * Compiles a CSS file, including optionally minifying and lowering syntax to the given
 * targets. A source map may also be generated, but this is not enabled by default.
 */
export async function transformCSS(
  specifier: string,
  code: string,
  options: TransformCSSOptions = {},
): Promise<TransformCSSResult> {
  await checkWasmReady();
  return parcelCSS(specifier, code, options);
}
