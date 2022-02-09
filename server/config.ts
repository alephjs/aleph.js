import { basename } from 'https://deno.land/std@0.125.0/path/mod.ts'
import log from '../shared/log.ts'
import util from '../shared/util.ts'
import type { ImportMap } from '../compiler/mod.ts'
import { getAlephPkgUri } from './helper.ts'

const defaultReactVersion = "17.0.2"

export function getDefaultImportMap(): ImportMap {
  const alephPkgUri = getAlephPkgUri()
  return {
    imports: {
      'aleph/': `${alephPkgUri}/`,
      'aleph/server': `${alephPkgUri}/server/mod.ts`,
      'aleph/react': `${alephPkgUri}/framework/react/mod.ts`,
      'react': `https://esm.sh/react@${defaultReactVersion}`,
      'react-dom': `https://esm.sh/react-dom@${defaultReactVersion}`,
      'react-dom/server': `https://esm.sh/react-dom@${defaultReactVersion}/server`,
    },
    scopes: {}
  }
}

/** load and upgrade the import maps from `import_map.json` */
export async function loadImportMap(importMapFile: string): Promise<ImportMap> {
  const defaultImportMap = getDefaultImportMap()
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

  importMap.imports = Object.assign({}, defaultImportMap.imports, importMap.imports)
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
