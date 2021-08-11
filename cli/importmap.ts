import { exists } from 'https://deno.land/std@0.96.0/fs/mod.ts'
import { join } from 'https://deno.land/std@0.96.0/path/mod.ts'
import { getFlag } from '../shared/flags.ts'
import log from '../shared/log.ts'

export const helpMessage = `
Usage:
    aleph importmap <dir> [...options]

<dir> represents the directory of the aleph.js app,
if the <dir> is empty, the current directory will be used.

Examples:
    - deno.land/std/ (Standard Modules)
      e.g. aleph importmap -a std/hash

    - deno.land/x/
      e.g. aleph importmap -a aleph/

Options:
    -a, --add    <package[@version]>  Add a package to the import map.
        --name   <alias>              Alias to use in import map.
____________________________________________________________________________
    -r, --remove <package>            Remove a package from the import map.
____________________________________________________________________________
    -u, --update                      Update all packages in the import map.
        --update <package>            Update a package to the latest version.
____________________________________________________________________________
    -h, --help                        Prints this help message
`
/**
 * Steps for URL resolution:
 * Check https://api.deno.land/modules/MODULE to see if module exists
 * Grab  to see if version exists
 *  or find latest version
 * If folder or file, Grab https://cdn.deno.land/MODULE/versions/VERSION/meta/meta.json
 *  to verify folder/file exists
 */

/** Type of object returned from https://cdn.deno.land/MODULE/meta/versions.json */
type ModVer = {
  latest: string,
  versions: string[]
}

/**
 * Type of json object returned from https://cdn.deno.land/MODULE/versions/VERSION/meta/meta.json
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

/** Import map file name */
export const mapFileName = 'import_map.json'

/** Command entry point */
export default async function (workingDir: string, flags: Record<string, any>) {
  log.debug('Args:', flags)
  const mapfile = join(workingDir, mapFileName)
  if (!exists(mapfile)) {
    log.fatal(`${mapfile} not found.`)
  }
  log.info('Found import map at', mapfile)

  const add = getFlag(flags, ['a', 'add'])
  // handle add
  if (add) {
    try {
      const mapping = await getURLMapping(add, getFlag(flags, ['name']))
      log.info(`Mapping ${mapping[0]} to ${mapping[1]}`)
      const file = JSON.parse(Deno.readTextFileSync(mapfile))
      if (mapping[0] in file.imports) {
        throw new Error(`Import Map already has a mapping for '${mapping[0]}'.`)
      }
      file.imports[mapping[0]] = mapping[1]
      Deno.writeTextFileSync(mapfile, JSON.stringify(file, null, 2))
      log.info('Done!')
    } catch (error) {
      log.fatal(error.message)
    }
  }

  const remove = getFlag(flags, ['r', 'remove'])
  if (remove) {
    try {
      const file = JSON.parse(Deno.readTextFileSync(mapfile))
      if (remove in file.imports) {
        log.info(`Removing mapping from ${remove} to ${file.imports[remove]}`)
        delete file.imports[remove]
      } else if (stripVer(remove) in file.imports) {
        log.info(`Removing mapping from ${stripVer(remove)} to ${file.imports[stripVer(remove)]}`)
        delete file.imports[stripVer(remove)]
      } else {
        throw new Error(`Could not find mapping for '${remove}'.`)
      }
      Deno.writeTextFileSync(mapfile, JSON.stringify(file, null, 2))
      log.info('Done!')
    } catch (error) {
      log.fatal(error.message)
    }
  }

  const update = getFlag(flags, ['u', 'update'])
  if (update) {
    try {
      const file = JSON.parse(Deno.readTextFileSync(mapfile))
      if (update !== 'true') {
        if (!(update in file.imports)) {
          throw new Error(`Could not find mapping for '${update}'.`)
        }
        const newver = await checkUpdate(update, file.imports[update])
        if (newver) {
          log.info(`Updating ${update} to url ${newver[1]}`)
          file.imports[update] = newver[1]
          Deno.writeTextFileSync(mapfile, JSON.stringify(file, null, 2))
          log.info(`Done!`)
        }
      } else {
        for (const im in file.imports) {
          const newver = await checkUpdate(im, file.imports[im])
          if (newver) {
            log.info(`Updating ${im} to url ${newver[1]}`)
            file.imports[im] = newver[1]
          }
        }
        Deno.writeTextFileSync(mapfile, JSON.stringify(file, null, 2))
        log.info('Done!')
      }
    } catch (error) {
      log.warn('Update failed, no imports were written.')
      log.fatal(error.message)
    }
  }
}

async function checkUpdate(name: string, url: string): Promise<[string, string] | undefined> {
  if (!url.includes('@')) {
    log.info(`${name} is already mapped to the rolling latest at ${url}`)
    return
  }
  const modname = url.match(/(?<=\/)[^\/]+(?=@)/)
  if (!modname) {
    throw new Error(`Invalid URL ${url}`)
  }
  const vcurrent = getVer(url)
  const vlatest = (await getModVer(modname[0])).latest
  if (vlatest === vcurrent) {
    log.info(`${name} is already at the latest version ${vlatest}`)
    return
  }
  log.info(`Found newer version for ${modname}: ${vcurrent} -> ${vlatest}`)
  const submod = url.substring(url.indexOf(vcurrent) + vcurrent.length)
  return getURLMapping(`${modname}@${vlatest}${submod}`, name)
}

export async function getURLMapping(module: string, name: string | undefined): Promise<[string, string]> {
  let url = ''
  if (module.startsWith('std')) {
    url = await getSTDUrl(module)
  } else {
    url = await getXUrl(module)
  }
  return name ? [name, url] : [stripVer(module), url]
}

export async function getSTDUrl(mod: string) {
  return `https://deno.land/${await getURL(mod)}`
}

export async function getXUrl(mod: string) {
  return `https://deno.land/x/${await getURL(mod)}`
}

async function getURL(mod: string) {
  if (!mod.endsWith('.ts') && !mod.endsWith('/')) {
    mod = mod + '/mod.ts'
  }
  const desired_version = mod.includes('@') ? mod.match(/(?<=@)[^/]+/) : undefined
  const vinfo = await getModVer(getModName(mod))
  let selected_version: string
  if (!desired_version) {
    selected_version = vinfo.latest
  } else if (!vinfo.versions.includes(desired_version[0])) {
    throw new Error(`Specified Version ${desired_version} does not exist for module ${getModName(mod)}.`)
  } else {
    selected_version = desired_version[0]
  }
  // todo: check file exists
  const minfo = await getMeta(getModName(mod), selected_version)
  const dir_list = minfo.directory_listing.map((e) => e.path)
  const submodule = getSubMod(mod)
  if (!dir_list.includes(submodule)) {
    throw new Error(`Location ${submodule} could not be found in module ${getModName(mod)}.`)
  }

  return `${getModName(mod)}@${selected_version}${decorateURL(submodule)}`
}

/** Fetches module version info from cdn.deno.land */
async function getModVer(mod: string): Promise<ModVer> {
  const req = await fetch(`https://cdn.deno.land/${mod}/meta/versions.json`)
  if (!req.ok) {
    throw new Error(`Could not fetch versions for module ${mod}.`)
  }
  const json = await req.json()
  return json as ModVer
}

/** Fetches module meta from cdn.deno.land */
async function getMeta(mod: string, ver: string): Promise<ModMeta> {
  const req = await fetch(`https://cdn.deno.land/${mod}/versions/${ver}/meta/meta.json`)
  if (!req.ok) {
    throw new Error(`Could not fetch file list for module ${mod}@${ver}.`)
  }
  const json = await req.json()
  return json as ModMeta
}

/** Given a importmap target ending with '/' or '.ts', returns the submodule path */
export function getSubMod(mod: string) {
  mod = mod.substring(mod.indexOf('/'))
  if (mod.endsWith('/')) {
    mod = mod.substring(0, mod.length - 1)
  }
  return mod
}

/** Given a importmap target, returns the module name */
export function getModName(mod: string) {
  return stripVer(mod.substring(0, mod.indexOf('/')))
}

/** Given a partial module url, returns it without the version identifier */
export function stripVer(pkg: string): string {
  return pkg.replace(/@[^/]+/, '')
}

function getVer(url: string): string | 'LATEST' {
  const ver = url.match(/(?<=@)[^/]+/)
  return ver ? ver[0] : 'LATEST'
}

/** Puts the trailing slash back on URLs */
function decorateURL(url: string) {
  return url.endsWith('.ts') ? url : url + '/'
}
