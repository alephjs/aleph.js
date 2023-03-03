import { isFilledArray, isFilledString, isLikelyHttpURL, isPlainObject, trimSuffix } from "../shared/util.ts";
import { isCanary, VERSION } from "../version.ts";
import { cacheFetch } from "./cache.ts";
import { JSONC, path, type TransformOptions } from "./deps.ts";
import log from "./log.ts";
import { getContentType } from "./media_type.ts";
import type { AlephConfig, CookieOptions, ImportMap, JSXConfig } from "./types.ts";

export const regJsxFile = /\.(jsx|tsx)$/;
export const regFullVersion = /@\d+\.\d+\.\d+/;
export const builtinModuleExts = ["tsx", "ts", "mts", "jsx", "js", "mjs"];

/** Stores and returns the `fn` output in the `globalThis` object. */
export async function globalIt<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const v: T | undefined = Reflect.get(globalThis, name);
  if (v !== undefined) {
    if (v instanceof Promise) {
      const ret = await v;
      Reflect.set(globalThis, name, ret);
      return ret;
    }
    return v;
  }
  const ret = fn();
  if (ret !== undefined) {
    Reflect.set(globalThis, name, ret);
  }
  return await ret.then((v) => {
    Reflect.set(globalThis, name, v);
    return v;
  });
}

/** Stores and returns the `fn` output in the `globalThis` object synchronously. */
export function globalItSync<T>(name: string, fn: () => T): T {
  const v: T | undefined = Reflect.get(globalThis, name);
  if (v !== undefined) {
    return v;
  }
  const ret = fn();
  if (ret !== undefined) {
    Reflect.set(globalThis, name, ret);
  }
  return ret;
}

/** Get the module URI of Aleph.js */
export function getAlephPkgUri(): string {
  return globalItSync("__ALEPH_PKG_URI", () => {
    const uriEnv = Deno.env.get("ALEPH_PKG_URI");
    if (uriEnv) {
      return uriEnv;
    }
    if (import.meta.url.startsWith("file://")) {
      return "https://aleph";
    }
    return `https://deno.land/x/${isCanary ? "aleph_canary" : "aleph"}@${VERSION}`;
  });
}

/** Get Aleph.js package URI. */
export function getAlephConfig(): AlephConfig | undefined {
  return Reflect.get(globalThis, "__ALEPH_CONFIG");
}

/** Get the import maps. */
export async function getImportMap(appDir?: string): Promise<ImportMap> {
  return await globalIt("__ALEPH_IMPORT_MAP", () => loadImportMap(appDir));
}

/** Get the jsx config. */
export async function getJSXConfig(appDir?: string): Promise<JSXConfig> {
  return await globalIt("__ALEPH_JSX_CONFIG", () => loadJSXConfig(appDir));
}

/** Get the deployment ID. */
export function getDeploymentId(): string | undefined {
  return Deno.env.get("DENO_DEPLOYMENT_ID");
}

export function cookieHeader(name: string, value: string, options?: CookieOptions): string {
  const cookie = [`${name}=${value}`];
  if (options) {
    if (options.expires) {
      cookie.push(`Expires=${new Date(options.expires).toUTCString()}`);
    }
    if (options.maxAge) {
      cookie.push(`Max-Age=${options.maxAge}`);
    }
    if (options.domain) {
      cookie.push(`Domain=${options.domain}`);
    }
    if (options.path) {
      cookie.push(`Path=${options.path}`);
    }
    if (options.httpOnly) {
      cookie.push("HttpOnly");
    }
    if (options.secure) {
      cookie.push("Secure");
    }
    if (options.sameSite) {
      cookie.push(`SameSite=${options.sameSite}`);
    }
  }
  return cookie.join("; ");
}

export function toResponse(v: unknown, headers: Headers): Response {
  if (
    typeof v === "string" ||
    v instanceof ArrayBuffer ||
    v instanceof Uint8Array ||
    v instanceof ReadableStream
  ) {
    return new Response(v, { headers: headers });
  }
  if (v instanceof Blob || v instanceof File) {
    headers.set("Content-Type", v.type);
    headers.set("Content-Length", v.size.toString());
    return new Response(v, { headers: headers });
  }
  if (isPlainObject(v) || Array.isArray(v)) {
    return Response.json(v, { headers });
  }
  if (v === null) {
    return new Response(null, { headers });
  }
  throw new Error("Invalid response type: " + typeof v);
}

export function fixResponse(res: Response, fixRedirect: boolean): Response {
  if (res.status >= 300 && res.status < 400 && fixRedirect) {
    return Response.json({ redirect: { location: res.headers.get("Location"), status: res.status } }, {
      status: 501,
    });
  }
  return res;
}

/**
 * Fix remote url to local path.
 * e.g. `https://esm.sh/v108/react@17.0.2?dev` -> `/-/esm.sh/react@17.0.2?dev`
 */
export function toLocalPath(url: string): string {
  if (isLikelyHttpURL(url)) {
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
      trimSuffix(pathname, "/"),
      search,
    ].filter(Boolean).join("");
  }
  return url;
}

/**
 * Restore the remote url from local path.
 * e.g. `/-/esm.sh/react@17.0.2` -> `https://esm.sh/v108/react@17.0.2`
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

/** Check if the url is a npm package from esm.sh */
export function isNpmPkg(url: string) {
  return url.startsWith("https://esm.sh/") && !url.endsWith(".js") && !url.endsWith(".css");
}

/** Find config file in the `appDir` if exits, or find in current working directory. */
async function findConfigFile(filenames: string[], appDir?: string): Promise<string | undefined> {
  let denoConfigFile: string | undefined;
  if (appDir) {
    denoConfigFile = await findFile(filenames, appDir);
  }
  // find config file in current working directory
  if (!denoConfigFile) {
    denoConfigFile = await findFile(filenames);
  }
  return denoConfigFile;
}

/** Check whether or not the given path exists as a directory. */
export async function existsDir(path: string): Promise<boolean> {
  try {
    const stat = await Deno.lstat(path);
    return stat.isDirectory;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false;
    }
    throw err;
  }
}

/** Check whether or not the given path exists as regular file. */
export async function existsFile(path: string): Promise<boolean> {
  try {
    const stat = await Deno.lstat(path);
    return stat.isFile;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false;
    }
    throw err;
  }
}

const { basename, dirname, fromFileUrl, join } = path;

/** Find file in the `cwd` directory. */
export async function findFile(filenames: string[], cwd = Deno.cwd()): Promise<string | undefined> {
  for (const filename of filenames) {
    const fullPath = join(cwd, filename);
    if (await existsFile(fullPath)) {
      return fullPath;
    }
  }
}

/** Get files in the directory. */
export async function getFiles(
  dir: string,
  filter?: (filename: string) => boolean,
  __path: string[] = [],
): Promise<string[]> {
  const list: string[] = [];
  if (await existsDir(dir)) {
    for await (const dirEntry of Deno.readDir(dir)) {
      if (dirEntry.isDirectory) {
        list.push(...await getFiles(join(dir, dirEntry.name), filter, [...__path, dirEntry.name]));
      } else {
        const filename = [".", ...__path, dirEntry.name].join("/");
        if (!filter || filter(filename)) {
          list.push(filename);
        }
      }
    }
  }
  return list;
}

/** Watch the directory and its subdirectories. */
export async function watchFs(rootDir: string, listener: (kind: "create" | "remove" | "modify", path: string) => void) {
  const timers = new Map();
  const debounce = (id: string, callback: () => void, delay: number) => {
    if (timers.has(id)) {
      clearTimeout(timers.get(id)!);
    }
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        callback();
      }, delay),
    );
  };
  const reIgnore = /[\/\\](\.git(hub)?|\.vscode|vendor|node_modules|dist|out(put)?|target)[\/\\]/;
  const ignore = (path: string) => reIgnore.test(path) || path.endsWith(".DS_Store");
  const allFiles = new Set<string>(
    (await getFiles(rootDir)).map((name) => join(rootDir, name)).filter((path) => !ignore(path)),
  );
  for await (const { kind, paths } of Deno.watchFs(rootDir, { recursive: true })) {
    if (kind !== "create" && kind !== "remove" && kind !== "modify") {
      continue;
    }
    for (const path of paths) {
      if (ignore(path)) {
        continue;
      }
      debounce(kind + path, async () => {
        try {
          await Deno.lstat(path);
          if (!allFiles.has(path)) {
            allFiles.add(path);
            listener("create", path);
          } else {
            listener("modify", path);
          }
        } catch (error) {
          if (error instanceof Deno.errors.NotFound) {
            allFiles.delete(path);
            listener("remove", path);
          } else {
            console.warn("watchFs:", error);
          }
        }
      }, 100);
    }
  }
}

/** Fetch source code from fs/cdn/cache. */
export async function fetchCode(
  specifier: string,
  target?: TransformOptions["target"],
): Promise<[code: string, contentType: string]> {
  const config = getAlephConfig();
  if (isLikelyHttpURL(specifier)) {
    const url = new URL(specifier);
    if (url.host === "aleph") {
      return [
        await Deno.readTextFile(fromFileUrl(new URL(".." + url.pathname, import.meta.url))),
        getContentType(url.pathname),
      ];
    }
    if (url.hostname === "esm.sh") {
      if (target && !url.pathname.includes(`/${target}/`) && !url.searchParams.has("target")) {
        url.searchParams.set("target", target);
      }
    }
    const res = await cacheFetch(url.href);
    if (res.status >= 400) {
      throw new Error(`fetch ${url.href}: ${res.status} - ${res.statusText}`);
    }
    return [await res.text(), res.headers.get("Content-Type") || getContentType(url.pathname)];
  }

  const root = config?.baseUrl ? fromFileUrl(new URL(".", config.baseUrl)) : Deno.cwd();
  return [await Deno.readTextFile(join(root, specifier)), getContentType(specifier)];
}

/** Load the JSX config base the given import maps and the existing deno config. */
export async function loadJSXConfig(appDir?: string): Promise<JSXConfig> {
  const jsxConfig: JSXConfig = {};
  const denoConfigFile = await findConfigFile(["deno.jsonc", "deno.json", "tsconfig.json"], appDir);
  if (denoConfigFile) {
    try {
      const { compilerOptions } = await parseJSONFile(denoConfigFile);
      const { jsx, jsxFactory, jsxFragmentFactory, jsxImportSource } = (compilerOptions || {}) as Record<
        string,
        unknown
      >;
      if (
        (jsx === undefined || jsx === "react-jsx" || jsx === "react-jsxdev") &&
        isFilledString(jsxImportSource)
      ) {
        jsxConfig.jsxImportSource = jsxImportSource;
      } else {
        if (typeof jsxFactory === "string") {
          jsxConfig.jsxPragma = jsxFactory;
        }
        if (typeof jsxFragmentFactory === "string") {
          jsxConfig.jsxPragmaFrag = jsxFragmentFactory;
        }
      }
      log.debug(`deno config ${basename(denoConfigFile)} loaded`);
    } catch (error) {
      log.error(`Failed to parse ${basename(denoConfigFile)}: ${error.message}`);
    }
  }
  return jsxConfig;
}

/** Load the import maps. */
export async function loadImportMap(appDir?: string): Promise<ImportMap> {
  const importMap: ImportMap = { __filename: "", imports: {}, scopes: {} };
  const denoConfigFile = await findConfigFile(["deno.jsonc", "deno.json"], appDir);
  let importMapFilename: string | undefined;
  if (denoConfigFile) {
    const confg = await parseJSONFile(denoConfigFile);
    if (!confg.importMap) {
      if (isPlainObject(confg.imports)) {
        Object.assign(importMap.imports, confg.imports);
      }
      if (isPlainObject(confg.scopes)) {
        Object.assign(importMap.scopes, confg.scopes);
      }
      return importMap;
    }
    importMapFilename = join(dirname(denoConfigFile), confg.importMap);
  }
  if (!importMapFilename) {
    importMapFilename = await findConfigFile(
      ["import_map", "import-map", "importmap", "importMap"].map((v) => `${v}.json`),
      appDir,
    );
  }
  if (importMapFilename) {
    try {
      const { __filename, imports, scopes } = await parseImportMap(importMapFilename);
      if (import.meta.url.startsWith("file://") && appDir) {
        const alephPkgUri = getAlephPkgUri();
        if (alephPkgUri === "https://aleph") {
          Object.assign(imports, {
            "aleph/": "https://aleph/",
            "aleph/react": "https://aleph/runtime/react/mod.ts",
            "aleph/react-client": "https://aleph/runtime/react/client.ts",
            "aleph/vue": "https://aleph/runtime/vue/mod.ts",
          });
        }
      }
      Object.assign(importMap, { __filename });
      Object.assign(importMap.imports, imports);
      Object.assign(importMap.scopes, scopes);
      log.debug(`import maps ${basename(importMapFilename)} loaded`);
    } catch (e) {
      log.error("loadImportMap:", e.message);
    }
  }
  return importMap;
}

// deno-lint-ignore no-explicit-any
export async function parseJSONFile(jsonFile: string): Promise<Record<string, any>> {
  const raw = await Deno.readTextFile(jsonFile);
  if (jsonFile.endsWith(".jsonc")) {
    return JSONC.parse(raw);
  }
  return JSON.parse(raw);
}

export async function parseImportMap(importMapFilename: string): Promise<ImportMap> {
  const importMap: ImportMap = { __filename: importMapFilename, imports: {}, scopes: {} };
  const data = await parseJSONFile(importMapFilename);
  const imports: Record<string, string> = toStringMap(data.imports);
  const scopes: Record<string, Record<string, string>> = {};
  if (isPlainObject(data.scopes)) {
    Object.entries(data.scopes).forEach(([scope, imports]) => {
      scopes[scope] = toStringMap(imports);
    });
  }
  Object.assign(importMap, { imports, scopes });
  return importMap;
}

function toStringMap(v: unknown): Record<string, string> {
  const m: Record<string, string> = {};
  if (isPlainObject(v)) {
    Object.entries(v).forEach(([key, value]) => {
      if (key === "") {
        return;
      }
      if (isFilledString(value)) {
        m[key] = value;
        return;
      }
      if (isFilledArray(value)) {
        for (const v of value) {
          if (isFilledString(v)) {
            m[key] = v;
            return;
          }
        }
      }
    });
  }
  return m;
}

/** A `MagicString` alternative using byte offsets */
export class MagicString {
  enc: TextEncoder;
  dec: TextDecoder;
  chunks: [number, Uint8Array][];

  constructor(source: string) {
    this.enc = new TextEncoder();
    this.dec = new TextDecoder();
    this.chunks = [[0, this.enc.encode(source)]];
  }

  overwrite(start: number, end: number, content: string) {
    for (let i = 0; i < this.chunks.length; i++) {
      const [offset, bytes] = this.chunks[i];
      if (offset !== -1 && start >= offset && end <= offset + bytes.length) {
        const left = bytes.subarray(0, start - offset);
        const right = bytes.subarray(end - offset);
        const insert = this.enc.encode(content);
        this.chunks.splice(i, 1, [offset, left], [-1, insert], [end, right]);
        return;
      }
    }
    throw new Error(`overwrite: invalid range: ${start}-${end}`);
  }

  toBytes(): Uint8Array {
    const length = this.chunks.reduce((sum, [, chunk]) => sum + chunk.length, 0);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const [, chunk] of this.chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  }

  toString() {
    return this.dec.decode(this.toBytes());
  }
}
