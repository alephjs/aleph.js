import { exists } from 'https://deno.land/std@0.96.0/fs/mod.ts'
import { join } from 'https://deno.land/std@0.96.0/path/mod.ts'
import { getFlag } from '../shared/flags.ts'
import log from '../shared/log.ts'

export const helpMessage = `
Usage:
    aleph importmap [dir] <...options>

[dir] : Directory of the import map, defaults to current directory.

Options:
____________________________________________________________________________
    -a, --add    <moduleID[@version]>  Add a module to the import map.

        --name   <alias>             Alias to use in import map.

        --path   <address>           Manually specify the address to map to.
                                     Requires --name.

        --rolling                    (NOT RECOMMENDED) Don't pin module to a
                                     specific version (always latest).
____________________________________________________________________________
    -r, --remove <module>            Remove a module from the import map.
____________________________________________________________________________
    -u, --update                     Update all modules in the import map.

        --update <module>            Update a module to the latest version.
____________________________________________________________________________
    -h, --help                        Prints this help message
____________________________________________________________________________
Examples:
 - moduleID -> address
 - std/ -> https://deno.land/std@<LATEST>/
 - std/hash -> https://deno.land/std@<LATEST>/hash/mod.ts
 - std/path/posix.ts -> https://deno.land/std@<LATEST>/path/posix.ts
 - std@0.96.0/hash -> https://deno.land/std@0.96.0/hash/mod.ts
 - aleph/framework/core -> https://deno.land/x/aleph/framework/core/mod.ts
`
/**
 * https://github.com/WICG/import-maps
 * https://deno.land/manual@v1.13.1/linking_to_external_code/import_maps
 */

type ModInfo = {
  success: boolean,
  data?: {
    name: string,
    description: string,
    star_count: number
  },
  error?: string
}

/** Object returned from https://cdn.deno.land/MODULE/meta/versions.json */
type ModVer = {
  latest: string,
  versions: string[]
}

/**
 * Object returned from https://cdn.deno.land/MODULE/versions/VERSION/meta/meta.json
 * @directory_listing recursive list of all files and subfolders in module.
 */
type ModMeta = {
  uploaded_at: Date
  directory_listing: ModDirEntry[]
  upload_options: {
    type: string
    repository: string
    subdir: string
    ref: string
  }
}

type ModDirEntry = {
  path: string
  size: number
  type: 'dir' | 'file'
}

type URLMappingArgs = {
  mod: string,
  submod: string,
  ver?: string,
  name?: string,
  rolling?: boolean,
  cdn?: string
}

export type ImportMap = {
  imports: Record<string, string>
  scopes: Record<string, Record<string, string>>
}

/** Import map file name */
export const mapFileName = 'import_map.json'

/** Command entry point */
export default async function (workingDir: string, flags: Record<string, any>) {
  log.debug('Args:', flags)
  const mapPath = join(workingDir, mapFileName)
  if (!exists(mapPath)) {
    log.fatal(`${mapPath} not found.`)
  }
  log.info('Found import map at', mapPath)
  const mapJson = JSON.parse(Deno.readTextFileSync(mapPath)) as ImportMap

  const toAdd = getFlag(flags, ['a', 'add'])
  // handle add
  if (toAdd) {
    try {
      const { count, skipped } = await add(
        mapJson,
        toAdd,
        getFlag(flags, ['name']),
        getFlag(flags, ['path']),
        Boolean(getFlag(flags, ['rolling'])))
      await writeImportMap(mapPath, mapJson)
      log.info(`Done! ${count} mappings added, ${skipped} mappings skipped.`)
    } catch (error) {
      log.error(error.message)
      log.fatal('Error occured, no changes written.')
    }
  }

  const toRemove = getFlag(flags, ['r', 'remove'])
  if (toRemove) {
    await runCommand(remove, mapPath, mapJson, toRemove, 'removed', 'Error occured, no changes written.')
  }

  const toUpdate = getFlag(flags, ['u', 'update'])
  if (toUpdate) {
    await runCommand(update, mapPath, mapJson, toUpdate, 'updated', 'Update failed, no imports were written.')
  }
}

async function runCommand(cmd: Function, mapPath: string, mapJson: ImportMap, id: string, action: string, failMsg: string) {
  try {
    const { count, skipped } = await cmd(mapJson, id)
    await writeImportMap(mapPath, mapJson)
    log.info(`Done! ${count} mappings ${action}, ${skipped} mappings skipped.`)
  } catch (error) {
    log.error(error.message)
    log.fatal(failMsg)
  }
}

/**
 * ----------------------------------------------------------------------------
 *                              Main Commands
 * ----------------------------------------------------------------------------
 */

export type CommandResult = {
  count: number,
  skipped: number
}

/**
 * Adds mapping to an ImportMap. Tries to resolve the latest version if not
 * specified. If http, tries to confirm the mapped module address is
 * reachable and exists.
 *
 * @param mapRef Reference to the ImportMap.
 * @param importID User friendly module name.
 * @param name Specifier to map from.
 * @param address Address to map to.
 * @param rolling True to not map to a specific version.
 * @returns The number of mappings, created and skipped.
 */
export async function add(
  mapRef: ImportMap,
  importID: string,
  name?: string,
  address?: string,
  rolling?: boolean
): Promise<CommandResult> {
  let mapping
  if (address) {
    mapping = name ? [name, address] : [importID, address]
  } else {
    mapping = await getURLMapping({ ...lexID(importID), name, rolling })
  }
  log.info(`Mapping ${mapping[0]} to ${mapping[1]}`)
  if (mapping[0] in mapRef.imports) {
    throw new Error(`Import Map already has a mapping for '${mapping[0]}'.`)
  }
  mapRef.imports[mapping[0]] = mapping[1]
  return { count: 1, skipped: 0 }
}

/**
 * Removes a mapping from an ImportMap.
 *
 * @param mapRef Reference to the ImportMap.
 * @param name Specifier of mapping to remove.
 * @returns The number of mappings, removed and skipped.
 */
export async function remove(mapRef: ImportMap, name: string): Promise<CommandResult> {
  if (name in mapRef.imports) {
    log.info(`Removing mapping from ${name} to ${mapRef.imports[name]}`)
    delete mapRef.imports[name]
  } else if (stripVer(name) in mapRef.imports) {
    log.info(`Removing mapping from ${stripVer(name)} to ${mapRef.imports[stripVer(name)]}`)
    delete mapRef.imports[stripVer(name)]
  } else {
    throw new Error(`Could not find mapping for '${name}'.`)
  }
  return { count: 1, skipped: 0 }
}

/**
 * Attempts to update one or all of the mappings in an ImportMap.
 *
 * @param mapRef Reference to the ImportMap
 * @param name Specifier of mapping to update, 'true' to update all.
 * @returns The number of mappings, updated and skipped.
 */
export async function update(mapRef: ImportMap, name: string): Promise<CommandResult> {
  if (name !== 'true') {
    if (!(name in mapRef.imports)) {
      throw new Error(`Could not find mapping for '${name}'.`)
    }
    const newver = await checkUpdateDeno(name, mapRef.imports[name])
    if (newver) {
      log.info(`Updating ${name} to url ${newver[1]}`)
      mapRef.imports[name] = newver[1]
      return { count: 1, skipped: 0 }
    }
    return { count: 0, skipped: 1 }
  } else {
    let count = 0
    let skipped = 0
    for (const im in mapRef.imports) {
      if (mapRef.imports[im].startsWith('https://deno.land/')) {
        const newver = await checkUpdateDeno(im, mapRef.imports[im])
        if (newver) {
          log.info(`Updating ${im} to url ${newver[1]}`)
          mapRef.imports[im] = newver[1]
          count++
          continue
        }
        skipped++
      } else if (mapRef.imports[im].startsWith('https://esm.sh/')) {
        const newver = await checkUpdateEsm(im, mapRef.imports[im])
        if (newver) {
          log.info(`Updating ${im} to url ${newver[1]}`)
          mapRef.imports[im] = newver[1]
          count++
          continue
        }
        skipped++
      } else {
        log.warn(`Address ${mapRef.imports[im]} is not yet supported for ${im}, skipping...`)
        skipped++
      }
    }
    return { count, skipped }
  }
}

/**
 * ----------------------------------------------------------------------------
 *                                   Updating
 * ----------------------------------------------------------------------------
 */

async function checkUpdateDeno(name: string, url: string): Promise<[string, string] | undefined> {
  const vcurrent = getVerFromURL(url)
  if (!vcurrent) {
    log.info(`${name} is already mapped to the rolling latest at ${url}`)
    return
  }
  const modname = url.match(/(?<=\/)[^\/]+(?=@)/)
  if (!modname) {
    log.warn(`Invalid URL ${url}, skipping...`)
    return
  }
  const vlatest = (await fetchDenoModVer(modname[0])).latest
  if (vlatest === vcurrent) {
    log.info(`${name} is already at the latest version ${vlatest}`)
    return
  }
  log.info(`Found newer version for ${modname}: ${vcurrent} -> ${vlatest}`)
  const submod = url.substring(url.indexOf(vcurrent) + vcurrent.length)
  return getURLMapping({ mod: modname[0], submod, ver: vlatest, name })
}

async function checkUpdateEsm(name: string, url: string) {
  const vcurrent = getVerFromURL(url)
  if (!vcurrent) {
    log.info(`${name} is already mapped to the rolling latest at ${url}`)
    return
  }
  const modname = url.match(/(?<=https:\/\/esm\.sh\/)[^\/@]+/)
  if (!modname) {
    log.warn(`Invalid URL ${url}, skipping...`)
    return
  }
  const vlatest = (await fetchEsmModVer(modname[0]))['dist-tags'].latest
  if (vlatest === vcurrent) {
    log.info(`${name} is already at the latest version ${vlatest}`)
    return
  }
  log.info(`Found newer version for ${modname}: ${vcurrent} -> ${vlatest}`)
  return getURLMapping({ mod: modname[0], submod: '', ver: vlatest, name, cdn: 'npm' })
}

/**
 * ----------------------------------------------------------------------------
 *                         URL Generation/Validation
 * ----------------------------------------------------------------------------
 */

/** Dispatches for name and cdn */
export async function getURLMapping({
  mod,
  submod,
  ver,
  name,
  rolling,
  cdn
}: URLMappingArgs): Promise<[string, string]> {
  log.debug(mod, submod, ver, name, cdn)
  let url = ''
  if (cdn === 'npm') {
    url = await getNPMUrl(mod, ver, rolling)
  } else if (mod === 'std') {
    url = await getSTDUrl(mod, submod, ver, rolling)
  } else {
    url = await getXUrl(mod, submod, ver, rolling)
  }
  return name ? [name, url] : [mod + submod, url]
}

async function getSTDUrl(mod: string, submod: string, ver?: string, roll?: boolean) {
  return `https://deno.land/${await getDenoModUriFrag('std', submod, ver, roll)}`
}

async function getXUrl(mod: string, submod: string, ver?: string, roll?: boolean) {
  return `https://deno.land/x/${await getDenoModUriFrag(mod, submod, ver, roll)}`
}

async function getNPMUrl(mod: string, ver?: string, roll?: boolean) {
  return `https://esm.sh/${await getEsmModUriFrag(mod, ver, roll)}`
}

/** Generates the url fragment for deno.land */
async function getDenoModUriFrag(mod: string, submod: string, desiredVer?: string, roll?: boolean) {
  if (!submod.endsWith('.ts') && !submod.endsWith('/')) {
    submod = submod + '/mod.ts'
  }
  if (!(await fetchDenoModInfo(mod)).success) {
    throw new Error(`Module ${mod} not found`)
  }
  let selectedVer: string
  const vinfo = await fetchDenoModVer(mod)
  if (!desiredVer) {
    selectedVer = vinfo.latest
  } else if (!vinfo.versions.includes(desiredVer)) {
    throw new Error(`Specified Version ${desiredVer} does not exist for module ${mod}.`)
  } else {
    selectedVer = desiredVer
  }

  const minfo = await fetchDenoModMeta(mod, selectedVer)
  const dir_list = minfo.directory_listing.map((e) => e.path)
  if (!dir_list.includes(stripTrailingSlash(submod))) {
    throw new Error(`Location ${submod} could not be found in module ${mod}.`)
  }
  return `${mod}${roll ? '' : '@' + selectedVer}${submod}`
}

async function getEsmModUriFrag(mod: string, desiredVer?: string, roll?: boolean) {
  let selectedVer = desiredVer
  const vinfo = await fetchEsmModVer(mod, desiredVer)
  if (!desiredVer) {
    selectedVer = vinfo['dist-tags'].latest
  } else if (!(desiredVer in vinfo.versions)) {
    throw new Error(`Specified Version ${desiredVer} does not exist for module ${mod}`)
  }
  return `${mod}${roll ? '' : '@' + selectedVer}`
}

/**
 * ----------------------------------------------------------------------------
 *                             Async Helpers
 * ----------------------------------------------------------------------------
 */

type NPMModMeta = {
  name: string,
  'dist-tags': {
    latest: string
  },
  versions: Record<string, any>
}

/** Fetches module info from https://api.deno.land/modules/MODULE */
async function fetchDenoModInfo(mod: string) {
  const req = await fetch(`https://api.deno.land/modules/${mod}`)
  if (!req.ok) {
    throw new Error(`Could not reach https://api.deno.land/modules/${mod}`)
  }
  const json = await req.json()
  return json as ModInfo
}

/** Fetches module version info from cdn.deno.land */
async function fetchDenoModVer(mod: string): Promise<ModVer> {
  const req = await fetch(`https://cdn.deno.land/${mod}/meta/versions.json`)
  if (!req.ok) {
    throw new Error(`Could not fetch versions for module ${mod}.`)
  }
  const json = await req.json()
  return json as ModVer
}

/** Fetches module meta from cdn.deno.land */
async function fetchDenoModMeta(mod: string, ver: string): Promise<ModMeta> {
  const req = await fetch(`https://cdn.deno.land/${mod}/versions/${ver}/meta/meta.json`)
  if (!req.ok) {
    throw new Error(`Could not fetch file list for module ${mod}@${ver}.`)
  }
  const json = await req.json()
  return json as ModMeta
}

/** Fetches module of a specific version from esm.sh, returns latest version if not specified, errors if fail */
async function fetchEsmModVer(mod: string, ver?: string) {
  const req = await fetch(`https://registry.npmjs.org/${mod}`)
  if (!req.ok) {
    throw new Error(`Could not fetch versions for module ${mod}.`)
  }
  const json = await req.json()
  return json as NPMModMeta
}

async function writeImportMap(path: string, obj: ImportMap) {
  await Deno.writeTextFile(path, JSON.stringify(obj, null, 2))
}

/**
 * ----------------------------------------------------------------------------
 *                                 Helpers
 * ----------------------------------------------------------------------------
 */

function getArgs(flags: Record<string, any>, keys: string[]): string[] {
  let value = []
  for (const key of keys) {
    if (key in flags) {
      if (flags[key] instanceof Array) {
        value.push(...flags[key])
      } else {
        value.push(flags[key])
      }
      break
    }
  }
  if (value.length === 0) {
    return []
  }
  return value.filter(x => x === true).map(x => String(x))
}

/**
 * Returns the module name, submodule name, and version, from a import id.
 * @param importID Import identifier in the form of MODULE(@VERSION)?(/SUBMODULE)?/?
 */
function lexID(importID: string) {
  let cdn
  if (importID.startsWith('@npm/')) {
    importID = importID.substring(5)
    cdn = 'npm'
  }
  return {
    mod: getModFromID(importID),
    submod: getSubModFromID(importID),
    ver: getVerFromURL(importID),
    cdn: cdn
  }
}

/** Gets rid of trailing backslash on directory paths */
function stripTrailingSlash(submod: string) {
  if (submod.endsWith('/')) {
    submod = submod.substring(0, submod.length - 1)
  }
  return submod
}

/** Given an import ID, returns the module name */
function getModFromID(id: string) {
  return id.includes('/') ? stripVer(id.substring(0, id.indexOf('/'))) : stripVer(id)
}

function getSubModFromID(id: string) {
  return id.includes('/') ? id.substring(id.indexOf('/')) : ''
}

/** Strip '@VERSION' from string */
function stripVer(pkg: string): string {
  return pkg.replace(/@[^/]+/, '')
}

/** Gets version number from import ID or URL */
function getVerFromURL(url: string): string | undefined {
  const ver = url.match(/(?<=@)[^/]+/)
  return ver ? ver[0] : undefined
}
