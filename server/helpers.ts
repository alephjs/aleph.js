import { basename, dirname, globToRegExp, join } from "https://deno.land/std@0.136.0/path/mod.ts";
import { JSONC } from "https://deno.land/x/jsonc_parser@v0.0.1/src/jsonc.ts";
import { createGenerator, type UnoGenerator } from "https://esm.sh/@unocss/core@0.33.2";
import { findFile } from "../lib/fs.ts";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import { isCanary, VERSION } from "../version.ts";
import type { AlephConfig, ImportMap, JSXConfig, ModuleLoader } from "./types.ts";

export const regFullVersion = /@\d+\.\d+\.\d+/;
export const builtinModuleExts = ["tsx", "ts", "mts", "jsx", "js", "mjs"];

/** Stores and returns the `fn` output in the `globalThis` object */
export async function globalIt<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const cache: T | undefined = Reflect.get(globalThis, name);
  if (cache !== undefined) {
    return cache;
  }
  const ret = await fn();
  if (ret !== undefined) {
    Reflect.set(globalThis, name, ret);
  }
  return ret;
}

/** Stores and returns the `fn` output in the `globalThis` object synchronously. */
export function globalItSync<T>(name: string, fn: () => T): T {
  const cache: T | undefined = Reflect.get(globalThis, name);
  if (cache !== undefined) {
    return cache;
  }
  const ret = fn();
  if (ret !== undefined) {
    Reflect.set(globalThis, name, ret);
  }
  return ret;
}

/* Get Aleph.js package URI. */
export function getAlephPkgUri(): string {
  return globalItSync("__ALEPH_PKG_URI", () => {
    const uriFromEnv = Deno.env.get("ALEPH_PKG_URI");
    if (uriFromEnv) {
      return uriFromEnv;
    }
    const DEV_PORT = Deno.env.get("ALEPH_DEV_PORT");
    if (DEV_PORT) {
      return `http://localhost:${DEV_PORT}`;
    }
    const version = Deno.env.get("ALEPH_VERSION") || VERSION;
    return `https://deno.land/x/${isCanary ? "aleph_canary" : "aleph"}@${version}`;
  });
}

/** Get the UnoCSS generator, return `null` if the presets are empty. */
export function getUnoGenerator(): UnoGenerator | null {
  const config: AlephConfig | undefined = Reflect.get(globalThis, "__ALEPH_CONFIG");
  if (config === undefined) {
    return null;
  }
  return globalItSync("__UNO_GENERATOR", () => {
    if (config?.build?.unocss?.presets) {
      return createGenerator(config.build.unocss);
    }
    return null;
  });
}

/** Get the deployment ID. */
export function getDeploymentId(): string | null {
  return Deno.env.get("DENO_DEPLOYMENT_ID") ?? null;
}

/**
 * fix remote url to local path.
 * e.g. `https://esm.sh/react@17.0.2?dev` -> `/-/esm.sh/react@17.0.2?dev`
 */
export function toLocalPath(url: string): string {
  if (util.isLikelyHttpURL(url)) {
    let { hostname, pathname, port, protocol, search } = new URL(url);
    const isHttp = protocol === "http:";
    if ((isHttp && port === "80") || (protocol === "https:" && port === "443")) {
      port = "";
    }
    return [
      "/-/",
      isHttp && "http_",
      hostname,
      port && "_" + port,
      util.trimSuffix(pathname, "/"),
      search,
    ].filter(Boolean).join("");
  }
  return url;
}

/**
 * restore the remote url from local path.
 * e.g. `/-/esm.sh/react@17.0.2` -> `https://esm.sh/react@17.0.2`
 */
export function restoreUrl(pathname: string): string {
  let [h, ...rest] = pathname.substring(3).split("/");
  let protocol = "https";
  if (h.startsWith("http_")) {
    h = h.substring(5);
    protocol = "http";
  }
  const [host, port] = h.split("_");
  return `${protocol}://${host}${port ? ":" + port : ""}/${rest.join("/")}`;
}

/** init loaders in `CLI` mode, or use prebuild loaders */
export async function initModuleLoaders(importMap: ImportMap): Promise<ModuleLoader[]> {
  const loaders: ModuleLoader[] = Reflect.get(globalThis, "__ALEPH_MODULE_LOADERS") || [];
  if (Deno.env.get("ALEPH_CLI")) {
    for (const key in importMap.imports) {
      if (/^\*\.{?(\w+, ?)*\w+}?$/i.test(key)) {
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
          if (loader !== null && typeof loader === "object" && typeof loader.load === "function") {
            const glob = "/**/" + key;
            const reg = globToRegExp(glob);
            const Loader = {
              meta: { src, glob },
              test: (pathname: string) => reg.test(pathname),
              load: (pathname: string, env: Record<string, unknown>) => loader.load(pathname, env),
            };
            loaders.push(Loader);
          }
        }
      }
    }
  }
  return loaders;
}

/** Load the JSX config base the given import maps and the existing deno config. */
export async function loadJSXConfig(importMap: ImportMap): Promise<JSXConfig> {
  const jsxConfig: JSXConfig = {};
  const denoConfigFile = await findFile(["deno.jsonc", "deno.json", "tsconfig.json"]);

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

  let fuzzRuntimeUrl: string | null = null;

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
        fuzzRuntimeUrl = url;
      }
      break;
    }
  }

  // get acctual react version from esm.sh
  if (fuzzRuntimeUrl) {
    log.info(`Checking ${jsxConfig.jsxRuntime} version...`);
    const text = await fetch(fuzzRuntimeUrl).then((resp) => resp.text());
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

/** Load the import maps from the working directory. */
export async function loadImportMap(): Promise<ImportMap> {
  const importMap: ImportMap = { __filename: "", imports: {}, scopes: {} };

  if (Deno.env.get("ALEPH_DEV")) {
    const alephPkgUri = Deno.env.get("ALEPH_PKG_URI") || `http://localhost:${Deno.env.get("ALEPH_DEV_PORT")}`;
    const importMapFile = join(Deno.env.get("ALEPH_DEV_ROOT")!, "import_map.json");
    const { __filename, imports, scopes } = await parseImportMap(importMapFile);
    Object.assign(importMap, {
      __filename,
      imports: {
        ...imports,
        "@unocss/": `${alephPkgUri}/lib/@unocss/`,
        "aleph/": `${alephPkgUri}/`,
        "aleph/server": `${alephPkgUri}/server/mod.ts`,
        "aleph/react": `${alephPkgUri}/framework/react/mod.ts`,
        "aleph/vue": `${alephPkgUri}/framework/vue/mod.ts`,
      },
      scopes,
    });
  }

  const importMapFile = await findFile(
    ["import_map", "import-map", "importmap", "importMap"].map((v) => `${v}.json`),
  );
  if (importMapFile) {
    try {
      const { __filename, imports, scopes } = await parseImportMap(importMapFile);
      Object.assign(importMap, { __filename });
      Object.assign(importMap.imports, imports);
      Object.assign(importMap.scopes, scopes);
    } catch (e) {
      log.error("loadImportMap:", e.message);
    }
  }

  return importMap;
}

export function applyImportMap(specifier: string, importMap: ImportMap): string {
  if (specifier in importMap.imports) {
    return importMap.imports[specifier];
  }
  for (const key in importMap.imports) {
    if (key.endsWith("/") && specifier.startsWith(key)) {
      return importMap.imports[key] + specifier.slice(key.length);
    }
  }
  // todo: support scopes
  return specifier;
}

export async function parseJSONFile(jsonFile: string): Promise<Record<string, unknown>> {
  const raw = await Deno.readTextFile(jsonFile);
  if (jsonFile.endsWith(".jsonc")) {
    return JSONC.parse(raw);
  }
  return JSON.parse(raw);
}

export async function parseImportMap(importMapFile: string): Promise<ImportMap> {
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
