import { isFilledArray, isFilledString, isLikelyHttpURL, isPlainObject, trimSuffix } from "../shared/util.ts";
import { isCanary, VERSION } from "../version.ts";
import { cacheFetch } from "./cache.ts";
import { jsonc, path, type TransformOptions } from "./deps.ts";
import log from "./log.ts";
import { getContentType } from "./media_type.ts";
import type { AlephConfig, CookieOptions, ImportMap, JSXConfig } from "./types.ts";

export const regJsxFile = /\.(jsx|tsx|mdx)$/;
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

export function getAppDir() {
  return globalItSync(
    "__ALEPH_APP_DIR",
    () => Deno.mainModule ? path.dirname(path.fromFileUrl(Deno.mainModule)) : Deno.cwd(),
  );
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
  const id = Deno.env.get("DENO_DEPLOYMENT_ID");
  if (id) {
    return id;
  }

  // or use git latest commit hash
  return globalItSync("__ALEPH_DEPLOYMENT_ID", () => {
    try {
      if (!Deno.args.includes("--dev")) {
        const gitDir = path.join(Deno.cwd(), ".git");
        if (Deno.statSync(gitDir).isDirectory) {
          const head = Deno.readTextFileSync(path.join(gitDir, "HEAD"));
          if (head.startsWith("ref: ")) {
            const ref = head.slice(5).trim();
            const refFile = path.join(gitDir, ref);
            return Deno.readTextFileSync(refFile).trim().slice(0, 8);
          }
        }
      }
    } catch {
      // ignore
    }
    return null;
  }) ?? undefined;
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

export function toResponse(v: unknown, init?: ResponseInit): Response {
  if (
    v instanceof ArrayBuffer ||
    v instanceof Uint8Array ||
    v instanceof ReadableStream
  ) {
    return new Response(v, init);
  }
  if (v instanceof Blob || v instanceof File) {
    const headers = new Headers(init?.headers);
    headers.set("Content-Type", v.type);
    headers.set("Content-Length", v.size.toString());
    return new Response(v, { ...init, headers });
  }
  try {
    return Response.json(v, init);
  } catch (_) {
    return new Response("Invalid response type: " + typeof v, { status: 500 });
  }
}

/**
 * Fix remote url to local path.
 * e.g. `https://esm.sh/react@18.2.0?dev` -> `/-/esm.sh/react@18.2.0?dev`
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
 * e.g. `/-/esm.sh/react@18.2.0` -> `https://esm.sh/v113/react@18.2.0`
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

  return [await Deno.readTextFile(path.join(getAppDir(), specifier)), getContentType(specifier)];
}

/** Load the JSX config base the given import maps and the existing deno config. */
export async function loadJSXConfig(appDir?: string): Promise<JSXConfig> {
  const jsxConfig: JSXConfig = {};
  const denoConfigFile = await findConfigFile(["deno.jsonc", "deno.json", "tsconfig.json"], appDir);
  if (denoConfigFile) {
    try {
      const { compilerOptions } = await parseJSONFile(denoConfigFile);
      const {
        jsx = "react",
        jsxFactory = "React.createElement",
        jsxFragmentFactory = "React.createElement",
        jsxImportSource,
      } = (compilerOptions ?? {}) as Record<string, string | undefined>;
      if (jsx === "preserve") {
        jsxConfig.jsx = "preserve";
      } else if ((jsx === "react-jsx" || jsx === "react-jsxdev") && jsxImportSource) {
        jsxConfig.jsx = "automatic";
        jsxConfig.jsxImportSource = jsxImportSource;
      } else {
        jsxConfig.jsx = "classic";
        jsxConfig.jsxPragma = jsxFactory;
        jsxConfig.jsxPragmaFrag = jsxFragmentFactory;
      }
      log.debug(`jsx config from ${basename(denoConfigFile)} loaded`);
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
    const confg = await parseJSONFile<Partial<ImportMap> & { importMap?: string }>(denoConfigFile);
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
            "aleph/react": "https://aleph/framework/react/mod.ts",
          });
        }
      }
      Object.assign(importMap, { __filename });
      Object.assign(importMap.imports, imports);
      Object.assign(importMap.scopes, scopes);
      log.debug(`import maps from ${basename(importMapFilename)} loaded`);
    } catch (e) {
      log.error("loadImportMap:", e.message);
    }
  }
  return importMap;
}

export async function parseJSONFile<T extends Record<string, unknown>>(jsonFile: string): Promise<T> {
  const raw = await Deno.readTextFile(jsonFile);
  if (jsonFile.endsWith(".jsonc")) {
    return jsonc.parse(raw) as T;
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
