import { basename, join } from "https://deno.land/std@0.125.0/path/mod.ts";
import { JSONC } from "https://deno.land/x/jsonc_parser@v0.0.1/src/jsonc.ts";
import type { ImportMap } from "../compiler/types.d.ts";
import { findFile } from "../lib/fs.ts";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import type { AlephJSXConfig } from "./types.d.ts";

export async function loadDenoJSXConfig(): Promise<AlephJSXConfig> {
  const global = globalThis as any;
  const config: AlephJSXConfig = {};

  if (Deno.env.get("ALEPH_DEV") && Deno.env.get("ALEPH_DEV_ROOT")) {
    const jsonFile = join(Deno.env.get("ALEPH_DEV_ROOT")!, "deno.json");
    const stat = await Deno.stat(jsonFile);
    const { default: { compilerOptions } } = await import(`${jsonFile}#mtime-${stat.mtime?.getTime()}`, {
      assert: { type: "json" },
    });
    if (compilerOptions?.jsx === "react-jsx" && util.isFilledString(compilerOptions?.jsxImportSource)) {
      config.jsxImportSource = compilerOptions.jsxImportSource;
      config.jsxRuntime = compilerOptions.jsxImportSource.includes("preact") ? "preact" : "react";
    } else {
      config.jsxRuntime = compilerOptions.jsxFactory === "h" ? "preact" : "react";
    }
  }

  if (util.isPlainObject(global.__DENO_JSX_CONFIG)) {
    Object.assign(config, global.__DENO_JSX_CONFIG);
  } else if (global.__DENO_JSX_CONFIG === undefined) {
    const jsxConfig: AlephJSXConfig = {};
    const denoConfigFile = await findFile(Deno.cwd(), ["deno.jsonc", "deno.json", "tsconfig.json"]);
    if (denoConfigFile) {
      try {
        const { compilerOptions } = await parseJSONFile(denoConfigFile);
        if (compilerOptions?.jsx === "react-jsx" && util.isFilledString(compilerOptions?.jsxImportSource)) {
          jsxConfig.jsxImportSource = compilerOptions.jsxImportSource;
          jsxConfig.jsxRuntime = compilerOptions.jsxImportSource.includes("preact") ? "preact" : "react";
        } else {
          jsxConfig.jsxRuntime = compilerOptions.jsxFactory === "h" ? "preact" : "react";
        }
      } catch (error) {
        log.error(`Failed to parse ${basename(denoConfigFile)}: ${error.message}`);
      }
    }
    global.__DENO_JSX_CONFIG = jsxConfig;
    Object.assign(config, jsxConfig);
  }

  return config;
}

export async function loadImportMap(): Promise<ImportMap> {
  if (Deno.env.get("ALEPH_DEV") && Deno.env.get("ALEPH_DEV_PORT") && Deno.env.get("ALEPH_DEV_ROOT")) {
    const alephPkgUri = `http://localhost:${Deno.env.get("ALEPH_DEV_PORT")}`;
    const jsonFile = join(Deno.env.get("ALEPH_DEV_ROOT")!, "import_map.json");
    const stat = await Deno.stat(jsonFile);
    const { default: { imports, scopes } } = await import(`${jsonFile}#mtime-${stat.mtime?.getTime()}`, {
      assert: { type: "json" },
    });
    return {
      imports: {
        ...imports,
        "aleph/": `${alephPkgUri}/`,
        "aleph/server": `${alephPkgUri}/server/mod.ts`,
        "aleph/react": `${alephPkgUri}/framework/react/mod.ts`,
      },
      scopes,
    };
  } else {
    const global = globalThis as any;
    if (util.isPlainObject(global.__IMPORT_MAP)) {
      return { ...global.__IMPORT_MAP };
    } else if (global.__IMPORT_MAP === undefined) {
      try {
        const importMapFile = await findFile(
          Deno.cwd(),
          ["import_map", "import-map", "importmap", "importMap"].map((name) => `${name}.json`),
        );
        if (importMapFile) {
          const m = await readImportMap(importMapFile);
          global.__IMPORT_MAP = m;
          return m;
        } else {
          global.__IMPORT_MAP = null;
        }
      } catch (e) {
        log.error("read import map:", e.message);
      }
    }
  }
  return { imports: {}, scopes: {} };
}

export async function parseJSONFile(jsonFile: string): Promise<any> {
  let raw = await Deno.readTextFile(jsonFile);
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

function toStringMap(v: any): Record<string, string> {
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
