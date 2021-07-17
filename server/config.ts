import { basename, join } from 'https://deno.land/std@0.100.0/path/mod.ts'
import type { ReactOptions } from '../compiler/mod.ts'
import { defaultReactVersion } from '../shared/constants.ts'
import { existsDir } from '../shared/fs.ts'
import log from '../shared/log.ts'
import util from '../shared/util.ts'
import type { BrowserNames, Config, ImportMap, PostCSSPlugin } from '../types.ts'
import { getAlephPkgUri } from './helper.ts'

export type RequiredConfig = Required<Config> & {
  srcDir: string
  build: Required<Config['build']>
  server: Required<Config['server']>
  react: ReactOptions
}

export function defaultConfig(): Readonly<RequiredConfig> {
  return {
    framework: 'react',
    srcDir: '/',
    basePath: '/',
    defaultLocale: 'en',
    locales: [],
    build: {
      target: 'es2015',
      browsers: {} as Record<BrowserNames, number>,
      outputDir: '/dist'
    },
    ssr: {},
    plugins: [],
    css: {
      cache: false,
      extract: {
        limit: 8 * 1024
      },
      postcss: { plugins: ['autoprefixer'] },
    },
    server: {
      rewrites: {},
      headers: {},
      middlewares: [],
      compress: true,
    },
    env: {},
    react: {
      version: defaultReactVersion,
      esmShBuildVersion: 43,
    }
  }
}

/** load config from `aleph.config.(ts|js|json)` */
export async function loadConfig(specifier: string): Promise<Config> {
  let data: Record<string, any> = {}
  if (specifier.endsWith('.json')) {
    const v = JSON.parse(await Deno.readTextFile(specifier))
    if (util.isPlainObject(v)) {
      data = v
    }
  } else {
    let { default: v } = await import('file://' + specifier)
    if (util.isFunction(v)) {
      v = await v()
    }
    if (util.isPlainObject(v)) {
      data = v
    }
  }

  const config: Config = {}
  const {
    framework,
    basePath,
    defaultLocale,
    locales,
    build,
    ssr,
    plugins,
    css,
    server,
    env,
  } = data
  if (isFramework(framework)) {
    config.framework = framework
  }
  if (util.isFilledString(basePath)) {
    config.basePath = util.cleanPath(basePath)
  }
  if (isLocaleID(defaultLocale)) {
    config.defaultLocale = defaultLocale
  }
  if (util.isArray(locales)) {
    locales.filter(id => !isLocaleID(id)).forEach(id => log.warn(`invalid locale ID '${id}'`))
    config.locales = Array.from(new Set(locales.filter(isLocaleID)))
  }
  if (util.isPlainObject(build)) {
    config.build = {
      target: isBuildTarget(build.target) ? build.target : 'es2015',
      browsers: util.isPlainObject(build.browsers) ? build.browsers : {},
      outputDir: util.isFilledString(build.outputDir) ? util.cleanPath(build.outputDir) : '/dist'
    }
  }
  if (typeof ssr === 'boolean') {
    config.ssr = ssr
  } else if (util.isPlainObject(ssr)) {
    const include = util.isArray(ssr.include) ? ssr.include.map(v => util.isFilledString(v) ? new RegExp(v) : v).filter(v => v instanceof RegExp) : []
    const exclude = util.isArray(ssr.exclude) ? ssr.exclude.map(v => util.isFilledString(v) ? new RegExp(v) : v).filter(v => v instanceof RegExp) : []
    config.ssr = { include, exclude }
  }
  if (util.isPlainObject(server)) {
    config.server = {
      headers: util.isPlainObject(server.headers) ? toStringMap(server.headers) : {},
      rewrites: util.isPlainObject(server.rewrites) ? toStringMap(server.rewrites) : {},
      middlewares: Array.isArray(server.middlewares) ? server.middlewares : [],
      compress: typeof server.compress === 'boolean' ? server.compress : true
    }
  }
  if (util.isPlainObject(css)) {
    const { extract, cache, modules, postcss } = css
    config.css = {
      cache: Boolean(cache),
      extract: util.isPlainObject(extract) ? { limit: typeof extract.limit === 'number' ? extract.limit : 8 * 1024 } : Boolean(extract),
      modules: util.isPlainObject(modules) ? modules : undefined,
      postcss: isPostcssConfig(postcss) ? postcss : { plugins: ['autoprefixer'] }
    }
  }
  if (util.isNEArray(plugins)) {
    config.plugins = plugins.filter(v => util.isPlainObject(v) && util.isFunction(v.setup))
  }
  if (util.isPlainObject(env)) {
    config.env = toStringMap(env)
    Object.entries(env).forEach(([key, value]) => Deno.env.set(key, value))
  }

  return config
}

export function getDefaultImportMap(): ImportMap {
  const alephPkgUri = getAlephPkgUri()
  return {
    imports: {
      'aleph/': `${alephPkgUri}/`,
      'aleph/types': `${alephPkgUri}/types.ts`,
      'framework': `${alephPkgUri}/framework/core/mod.ts`,
      'framework/react': `${alephPkgUri}/framework/react/mod.ts`,
      'react': `https://esm.sh/react@${defaultReactVersion}`,
      'react-dom': `https://esm.sh/react-dom@${defaultReactVersion}`
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

  // in aleph dev mode, replace default imports
  if (Deno.env.get('ALEPH_DEV') !== undefined) {
    Object.assign(importMap.imports, defaultImportMap.imports)
  } else {
    importMap.imports = Object.assign({}, defaultImportMap.imports, importMap.imports)
  }

  return importMap
}

/**
 * fix config and import map
 * - set default `srcDir` to '/src' if it exists
 * - fix import map when the `srcDir` does not equal '/'
 * - respect react version in import map
 * - add builtin css loader plugin
 */
export async function fixConfigAndImportMap(workingDir: string, config: RequiredConfig, importMap: ImportMap) {
  // set default src directory
  if (
    config.srcDir === '/' &&
    !await existsDir(join(workingDir, 'pages')) &&
    await existsDir(join(workingDir, 'src', 'pages'))
  ) {
    config.srcDir = '/src'
  }

  Object.keys(importMap.imports).forEach(key => {
    const url = importMap.imports[key]
    // strip `srcDir` prefix
    if (config.srcDir !== '/' && url.startsWith('.' + config.srcDir)) {
      importMap.imports[key] = '.' + util.trimPrefix(url, '.' + config.srcDir)
    }
    // react verison should respect the import maps
    if (/\/\/esm\.sh\/react@\d+\.\d+\.\d+(-[a-z0-9\.]+)?$/.test(url)) {
      config.react.version = url.split('@').pop()!
    }
  })
}

function isFramework(v: any): v is 'react' {
  switch (v) {
    case 'react':
      return true
    default:
      return false
  }
}

function isBuildTarget(v: any): v is 'es2015' | 'es2016' | 'es2017' | 'es2018' | 'es2019' | 'es2020' | 'esnext' {
  switch (v) {
    case 'es2015':
    case 'es2016':
    case 'es2017':
    case 'es2018':
    case 'es2019':
    case 'es2020':
    case 'esnext':
      return true
    default:
      return false
  }
}

function isPostcssConfig(v: any): v is { plugins: PostCSSPlugin[] } {
  return util.isPlainObject(v) && util.isArray(v.plugins)
}

const reLocaleID = /^[a-z]{2}(-[a-zA-Z0-9]+)?$/
function isLocaleID(v: any): v is string {
  return util.isFilledString(v) && reLocaleID.test(v)
}

function toStringMap(v: any): Record<string, string> {
  const imports: Record<string, string> = {}
  if (util.isPlainObject(v)) {
    Object.entries(v).forEach(([key, value]) => {
      if (key == '') {
        return
      }
      if (util.isFilledString(value)) {
        imports[key] = value
        return
      } else if (util.isNEArray(value)) {
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
