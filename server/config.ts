import { join } from "https://deno.land/std@0.125.0/path/mod.ts";
import type { ImportMap } from "../compiler/types.d.ts";
import { findFile } from "../lib/fs.ts";
import log from "../lib/log.ts";
import util from "../lib/util.ts";

export async function resolveImportMap(): Promise<ImportMap> {
  if (Deno.env.get("ALEPH_DEV") && Deno.env.get("ALEPH_DEV_PORT")) {
    const alephPkgUri = `http://localhost:${Deno.env.get("ALEPH_DEV_PORT")}`;
    const jsonFile = join(Deno.env.get("ALEPH_ROOT")!, "import_map.json");
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
      return global.__IMPORT_MAP;
    } else if (global.__IMPORT_MAP === undefined) {
      try {
        const importMapFile = await findFile(
          Deno.cwd(),
          ["import_map", "import-map", "importmap", "importMap"].map((name) => `${name}.json`),
        );
        const isDev = Deno.env.get("ALEPH_DEV") === "development";
        if (importMapFile) {
          const m = await readImportMap(importMapFile);
          if (!isDev) {
            global.__IMPORT_MAP = m;
          }
          return m;
        } else {
          if (!isDev) {
            global.__IMPORT_MAP = null;
          }
        }
      } catch (e) {
        log.error("read import map:", e.message);
      }
    }
  }
  return { imports: {}, scopes: {} };
}

export async function readImportMap(importMapFile: string): Promise<ImportMap> {
  const importMap: ImportMap = { imports: {}, scopes: {} };
  const data = JSON.parse(await Deno.readTextFile(importMapFile));
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
  const imports: Record<string, string> = {};
  if (util.isPlainObject(v)) {
    Object.entries(v).forEach(([key, value]) => {
      if (key === "") {
        return;
      }
      if (util.isFilledString(value)) {
        imports[key] = value;
        return;
      }
      if (util.isFilledArray(value)) {
        for (const v of value) {
          if (util.isFilledString(v)) {
            imports[key] = v;
            return;
          }
        }
      }
    });
  }
  return imports;
}
