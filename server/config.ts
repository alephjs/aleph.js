import { basename, join } from "https://deno.land/std@0.125.0/path/mod.ts";
import { JSONC } from "https://deno.land/x/jsonc_parser@v0.0.1/src/jsonc.ts";
import type { ImportMap } from "../compiler/types.d.ts";
import { findFile } from "../lib/fs.ts";
import { toLocalPath } from "../lib/path.ts";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import type { JSXConfig } from "../types.d.ts";
import { VERSION } from "../version.ts";

export function getAlephPkgUri() {
  const global = globalThis as Record<string, unknown>;
  if (util.isFilledString(global.__ALEPH_PKG_URI)) {
    return global.__ALEPH_PKG_URI;
  }
  let uri = `https://deno.land/x/aleph@v${VERSION}`;
  const DEV_PORT = Deno.env.get("ALEPH_DEV_PORT");
  if (DEV_PORT) {
    uri = `http://localhost:${DEV_PORT}`;
  }
  global.__ALEPH_PKG_URI = uri;
  return uri;
}

export async function loadJSXConfig(): Promise<JSXConfig> {
  const isDev = Deno.env.get("ALEPH_ENV") === "development";
  const jsxConfig: JSXConfig = {};

  if (Deno.env.get("ALEPH_DEV")) {
    const jsonFile = join(Deno.env.get("ALEPH_DEV_ROOT")!, "deno.json");
    const { compilerOptions } = await parseJSONFile(jsonFile);
    const { jsx, jsxImportSource, jsxFactory } = (compilerOptions || {}) as Record<string, unknown>;
    if (
      (jsx === "react-jsx" || jsx === "react-jsxdev") &&
      util.isFilledString(jsxImportSource)
    ) {
      jsxConfig.jsxImportSource = jsxImportSource;
      jsxConfig.jsxRuntime = jsxImportSource.includes("preact") ? "preact" : "react";
    } else if (jsx === "react") {
      jsxConfig.jsxRuntime = jsxFactory === "h" ? "preact" : "react";
    }
  }

  const appJsxConfig: JSXConfig = {};
  const denoConfigFile = await findFile(Deno.cwd(), ["deno.jsonc", "deno.json", "tsconfig.json"]);
  if (denoConfigFile) {
    try {
      const { compilerOptions } = await parseJSONFile(denoConfigFile);
      const { jsx, jsxImportSource, jsxFactory } = (compilerOptions || {}) as Record<string, unknown>;
      if (
        (jsx === "react-jsx" || jsx === "react-jsxdev") &&
        util.isFilledString(jsxImportSource)
      ) {
        appJsxConfig.jsxImportSource = jsxImportSource;
        appJsxConfig.jsxRuntime = jsxImportSource.includes("preact") ? "preact" : "react";
      } else if (jsx === "react") {
        appJsxConfig.jsxRuntime = jsxFactory === "h" ? "preact" : "react";
      }
    } catch (error) {
      log.error(`Failed to parse ${basename(denoConfigFile)}: ${error.message}`);
    }
  }

  Object.assign(jsxConfig, appJsxConfig);
  if (isDev && jsxConfig.jsxImportSource && util.isLikelyHttpURL(jsxConfig.jsxImportSource)) {
    jsxConfig.jsxImportSource = toLocalPath(jsxConfig.jsxImportSource);
  }
  return jsxConfig;
}

export async function loadImportMap(): Promise<ImportMap> {
  const importMap: ImportMap = { imports: {}, scopes: {} };

  if (Deno.env.get("ALEPH_DEV")) {
    const alephPkgUri = `http://localhost:${Deno.env.get("ALEPH_DEV_PORT")}`;
    const jsonFile = join(Deno.env.get("ALEPH_DEV_ROOT")!, "import_map.json");
    const { imports, scopes } = await readImportMap(jsonFile);
    Object.assign(importMap, {
      imports: {
        ...imports,
        "aleph/": `${alephPkgUri}/`,
        "aleph/server": `${alephPkgUri}/server/mod.ts`,
        "aleph/react": `${alephPkgUri}/framework/react/mod.ts`,
      },
      scopes,
    });
  }

  const importMapFile = await findFile(
    Deno.cwd(),
    ["import_map", "import-map", "importmap", "importMap"].map((v) => `${v}.json`),
  );
  if (importMapFile) {
    try {
      const { imports, scopes } = await readImportMap(importMapFile);
      Object.assign(importMap.imports, imports);
      Object.assign(importMap.scopes, scopes);
    } catch (e) {
      log.error("Read import map:", e.message);
    }
  }

  return importMap;
}

export async function parseJSONFile(jsonFile: string): Promise<Record<string, unknown>> {
  const raw = await Deno.readTextFile(jsonFile);
  if (jsonFile.endsWith(".jsonc")) {
    return JSONC.parse(raw);
  }
  return JSON.parse(raw);
}

export async function readImportMap(importMapFile: string): Promise<ImportMap> {
  const importMap: ImportMap = { imports: {}, scopes: {} };
  const data = await parseJSONFile(importMapFile);
  const imports: Record<string, string> = toStringMap(data.imports);
  const scopes: Record<string, Record<string, string>> = {};
  if (util.isPlainObject(data.scopes)) {
    Object.entries(data.scopes).forEach(([scope, imports]) => {
      scopes[scope] = toStringMap(imports);
    });
  }
  Object.assign(importMap, { imports, scopes });
  return importMap;
}

function toStringMap(v: unknown): Record<string, string> {
  const m: Record<string, string> = {};
  if (util.isPlainObject(v)) {
    Object.entries(v).forEach(([key, value]) => {
      if (key === "") {
        return;
      }
      if (util.isFilledString(value)) {
        m[key] = value;
        return;
      }
      if (util.isFilledArray(value)) {
        for (const v of value) {
          if (util.isFilledString(v)) {
            m[key] = v;
            return;
          }
        }
      }
    });
  }
  return m;
}
