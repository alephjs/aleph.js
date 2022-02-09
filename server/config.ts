import { basename } from 'https://deno.land/std@0.125.0/path/mod.ts'
import log from '../shared/log.ts'
import util from '../shared/util.ts'
import type { ImportMap } from '../compiler/mod.ts'

/** load and upgrade the import maps from `import_map.json` */
export async function loadImportMap(importMapFile: string): Promise<ImportMap> {
  const importMap: ImportMap = { imports: {}, scopes: {} }
  try {
    const data = JSON.parse(await Deno.readTextFile(importMapFile))
    const imports: Record<string, string> = toStringMap(data.imports)
    const scopes: Record<string, Record<string, string>> = {}
    if (util.isPlainObject(data.scopes)) {
      Object.entries(data.scopes).forEach(([scope, imports]) => {
        scopes[scope] = toStringMap(imports)
      })
    }
    Object.assign(importMap, { imports, scopes })
  } catch (e) {
    log.error(`invalid '${basename(importMapFile)}':`, e.message)
    if (!confirm('Continue?')) {
      Deno.exit(1)
    }
  }
  return importMap
}

function toStringMap(v: any): Record<string, string> {
  const imports: Record<string, string> = {}
  if (util.isPlainObject(v)) {
    Object.entries(v).forEach(([key, value]) => {
      if (key === '') {
        return
      }
      if (util.isFilledString(value)) {
        imports[key] = value
        return
      }
      if (util.isFilledArray(value)) {
        for (const v of value) {
          if (util.isFilledString(v)) {
            imports[key] = v
            return
          }
        }
      }
    })
  }
  return imports
}
