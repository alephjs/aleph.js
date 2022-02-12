import init, { transform as swc, transformCSS as parcelCSS } from "./dist/compiler.js";
import getWasmData from "./dist/wasm.js";
import {
  InlineStyleExpr,
  TransformCSSOptions,
  TransformCSSResult,
  TransformOptions,
  TransformResult,
} from "./types.d.ts";

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
  const wasmData = getWasmData();
  await init(wasmData);
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
  const { inlineStylePreprocess, ...transformOptions } = options;
  let { code: jsContent, inlineStyles, ...rest } = swc(specifier, code, transformOptions);

  // resolve inline-style
  if (inlineStyles) {
    await Promise.all(
      Object.entries(inlineStyles as Record<string, InlineStyleExpr>).map(async ([key, style]) => {
        let tpl = style.quasis.reduce((tpl, quais, i, a) => {
          tpl += quais;
          if (i < a.length - 1) {
            tpl += `%%aleph-inline-style-expr-${i}%%`;
          }
          return tpl;
        }, "")
          .replace(/\:\s*%%aleph-inline-style-expr-(\d+)%%/g, (_, id) => `: var(--aleph-inline-style-expr-${id})`)
          .replace(/%%aleph-inline-style-expr-(\d+)%%/g, (_, id) => `/*%%aleph-inline-style-expr-${id}%%*/`);
        if (inlineStylePreprocess !== undefined) {
          tpl = await inlineStylePreprocess("#" + key, style.type, tpl);
        }
        tpl = tpl.replace(
          /\:\s*var\(--aleph-inline-style-expr-(\d+)\)/g,
          (_, id) => ": ${" + style.exprs[parseInt(id)] + "}",
        ).replace(
          /\/\*%%aleph-inline-style-expr-(\d+)%%\*\//g,
          (_, id) => "${" + style.exprs[parseInt(id)] + "}",
        );
        jsContent = jsContent.replace(`"%%${key}-placeholder%%"`, "`" + tpl + "`");
      }),
    );
  }

  return { code: jsContent, ...rest };
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
  return parcelCSS(
    specifier,
    code,
    options,
  );
}
