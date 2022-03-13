import { basename, dirname, globToRegExp, join } from "https://deno.land/std@0.128.0/path/mod.ts";
import { JSONC } from "https://deno.land/x/jsonc_parser@v0.0.1/src/jsonc.ts";
import { findFile } from "../lib/fs.ts";
import { globalIt } from "../lib/helpers.ts";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import { isCanary, VERSION } from "../version.ts";
import type { ImportMap, JSXConfig, ModuleLoader } from "./types.ts";

export function getAlephPkgUri() {
  return globalIt("__ALEPH_PKG_URI", () => {
    const DEV_PORT = Deno.env.get("ALEPH_DEV_PORT");
    if (DEV_PORT) {
      return `http://localhost:${DEV_PORT}`;
    }
    const version = Deno.env.get("ALEPH_VERSION") || VERSION;
    return `https://deno.land/x/${isCanary ? "aleph_canary" : "aleph"}@${version}`;
  });
}

export async function loadJSXConfig(importMap: ImportMap): Promise<JSXConfig> {
  const jsxConfig: JSXConfig = {};
  const denoConfigFile = await findFile(Deno.cwd(), ["deno.jsonc", "deno.json", "tsconfig.json"]);

  if (denoConfigFile) {
    try {
      const { compilerOptions } = await parseJSONFile(denoConfigFile);
      const { jsx, jsxImportSource, jsxFactory } = (compilerOptions || {}) as Record<string, unknown>;
      if (
        (jsx === undefined || jsx === "react-jsx" || jsx === "react-jsxdev") &&
        util.isFilledString(jsxImportSource)
      ) {
        jsxConfig.jsxImportSource = jsxImportSource;
        jsxConfig.jsxRuntime = jsxImportSource.includes("preact") ? "preact" : "react";
      } else if (jsx === undefined || jsx === "react") {
        jsxConfig.jsxRuntime = jsxFactory === "h" ? "preact" : "react";
      }
    } catch (error) {
      log.error(`Failed to parse ${basename(denoConfigFile)}: ${error.message}`);
    }
  } else if (Deno.env.get("ALEPH_DEV")) {
    const jsonFile = join(Deno.env.get("ALEPH_DEV_ROOT")!, "deno.json");
    const { compilerOptions } = await parseJSONFile(jsonFile);
    const { jsx, jsxImportSource, jsxFactory } = (compilerOptions || {}) as Record<string, unknown>;
    if (
      (jsx === undefined || jsx === "react-jsx" || jsx === "react-jsxdev") &&
      util.isFilledString(jsxImportSource)
    ) {
      jsxConfig.jsxImportSource = jsxImportSource;
      jsxConfig.jsxRuntime = jsxImportSource.includes("preact") ? "preact" : "react";
    } else if (jsx === undefined || jsx === "react") {
      jsxConfig.jsxRuntime = jsxFactory === "h" ? "preact" : "react";
    }
  }

  let fuzzReactUrl: string | null = null;

  for (const url of Object.values(importMap.imports)) {
    let m = url.match(/^https?:\/\/esm\.sh\/(p?react)@(\d+\.\d+\.\d+(-[a-z\d.]+)*)(\?|$)/);
    if (!m) {
      m = url.match(/^https?:\/\/esm\.sh\/(p?react)@.+/);
    }
    if (m) {
      const { searchParams } = new URL(url);
      if (searchParams.has("pin")) {
        jsxConfig.jsxRuntimeCdnVersion = util.trimPrefix(searchParams.get("pin")!, "v");
      }
      if (!jsxConfig.jsxRuntime) {
        jsxConfig.jsxRuntime = m[1] as "react" | "preact";
      }
      if (m[2]) {
        jsxConfig.jsxRuntimeVersion = m[2];
        if (jsxConfig.jsxImportSource) {
          jsxConfig.jsxImportSource = `https://esm.sh/${jsxConfig.jsxRuntime}@${m[2]}`;
        }
      } else {
        fuzzReactUrl = url;
      }
      break;
    }
  }

  // get acctual react version from esm.sh
  if (fuzzReactUrl) {
    log.info(`Checking ${jsxConfig.jsxRuntime} version...`);
    const text = await fetch(fuzzReactUrl).then((resp) => resp.text());
    const m = text.match(/https?:\/\/cdn\.esm\.sh\/(v\d+)\/p?react@(\d+\.\d+\.\d+(-[a-z\d.]+)*)\//);
    if (m) {
      jsxConfig.jsxRuntimeCdnVersion = m[1].slice(1);
      jsxConfig.jsxRuntimeVersion = m[2];
      if (jsxConfig.jsxImportSource) {
        jsxConfig.jsxImportSource = `https://esm.sh/${jsxConfig.jsxRuntime}@${m[2]}`;
      }
      log.info(`${jsxConfig.jsxRuntime}@${jsxConfig.jsxRuntimeVersion} is used`);
    }
  }

  return jsxConfig;
}

export async function loadImportMap(): Promise<ImportMap> {
  const importMap: ImportMap = { __filename: "", imports: {}, scopes: {} };

  if (Deno.env.get("ALEPH_DEV")) {
    const alephPkgUri = `http://localhost:${Deno.env.get("ALEPH_DEV_PORT")}`;
    const importMapFile = join(Deno.env.get("ALEPH_DEV_ROOT")!, "import_map.json");
    const { __filename, imports, scopes } = await readImportMap(importMapFile);
    Object.assign(importMap, {
      __filename,
      imports: {
        ...imports,
        "aleph/": `${alephPkgUri}/`,
        "aleph/server": `${alephPkgUri}/server/mod.ts`,
        "aleph/react": `${alephPkgUri}/framework/react/mod.ts`,
        "aleph/vue": `${alephPkgUri}/framework/vue/mod.ts`,
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
      const { __filename, imports, scopes } = await readImportMap(importMapFile);
      Object.assign(importMap, { __filename });
      Object.assign(importMap.imports, imports);
      Object.assign(importMap.scopes, scopes);
    } catch (e) {
      log.error("loadImportMap:", e.message);
    }
  }

  return importMap;
}

export async function initModuleLoaders(importMap: ImportMap): Promise<ModuleLoader[]> {
  const loaders: ModuleLoader[] = [];
  for (const key in importMap.imports) {
    if (/^\*\.[a-z0-9]+$/i.test(key)) {
      let src = importMap.imports[key];
      if (src.endsWith("!loader")) {
        src = util.trimSuffix(src, "!loader");
        if (src.startsWith("./") || src.startsWith("../")) {
          src = "file://" + join(dirname(importMap.__filename), src);
        }
        let { default: loader } = await import(src);
        if (typeof loader === "function") {
          loader = new loader();
        }
        if (
          typeof loader === "object" && loader !== null &&
          typeof loader.test === "function" && typeof loader.load === "function"
        ) {
          const reg = globToRegExp("/**/" + key);
          loaders.push({
            test: (pathname: string) => {
              return reg.test(pathname) && loader.test(pathname);
            },
            load: (pathname: string, env: Record<string, unknown>) => loader.load(pathname, env),
          });
        }
      }
    }
  }
  return loaders;
}

export async function parseJSONFile(jsonFile: string): Promise<Record<string, unknown>> {
  const raw = await Deno.readTextFile(jsonFile);
  if (jsonFile.endsWith(".jsonc")) {
    return JSONC.parse(raw);
  }
  return JSON.parse(raw);
}

export async function readImportMap(importMapFile: string): Promise<ImportMap> {
  const importMap: ImportMap = { __filename: importMapFile, imports: {}, scopes: {} };
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
