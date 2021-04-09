import { join } from 'std/path/mod.ts'
import type { ImportMap, ReactResolve } from '../compiler/mod.ts'
import { defaultReactVersion } from '../shared/constants.ts'
import { existsFileSync, existsDirSync } from '../shared/fs.ts'
import log from '../shared/log.ts'
import util from '../shared/util.ts'
import type { Config, PostCSSPlugin } from '../types.ts'
import { getAlephPkgUri, reLocaleID } from './helper.ts'

export const defaultConfig: Readonly<Required<Config> & { react: ReactResolve }> = {
  framework: 'react',
  buildTarget: 'es2015',
  baseUrl: '/',
  srcDir: '/',
  outputDir: '/dist',
  defaultLocale: 'en',
  locales: [],
  rewrites: {},
  ssr: {},
  plugins: [],
  postcss: { plugins: ['autoprefixer'] },
  headers: {},
  env: {},
  react: {
    version: defaultReactVersion,
    esmShBuildVersion: 34,
  }
}

/** load config from `aleph.config.(ts|js|json)` */
export async function loadConfig(workingDir: string): Promise<Config> {
  let data: Config = {}
  for (const name of ['ts', 'js', 'json'].map(ext => 'aleph.config.' + ext)) {
    const p = join(workingDir, name)
    if (existsFileSync(p)) {
      if (name.endsWith('.json')) {
        const v = JSON.parse(await Deno.readTextFile(p))
        if (util.isPlainObject(v)) {
          data = v
        }
      } else {
        let { default: v } = await import('file://' + p)
        if (util.isFunction(v)) {
          v = await v()
        }
        if (util.isPlainObject(v)) {
          data = v
        }
      }
      log.info('Config loaded from', name)
      break
    }
  }

  const config: Config = {}
  const {
    framework,
    srcDir,
    outputDir,
    baseUrl,
    buildTarget,
    defaultLocale,
    locales,
    ssr,
    rewrites,
    plugins,
    postcss,
    headers,
    env,
  } = data
  if (isFramework(framework)) {
    config.framework = framework
  }
  if (util.isNEString(srcDir)) {
    config.srcDir = util.cleanPath(srcDir)
  } else if (
    !existsDirSync(join(workingDir, 'pages')) &&
    existsDirSync(join(workingDir, 'src', 'pages'))
  ) {
    config.srcDir = '/src'
  }
  if (util.isNEString(outputDir)) {
    config.outputDir = util.cleanPath(outputDir)
  }
  if (util.isNEString(baseUrl)) {
    config.baseUrl = util.cleanPath(baseUrl)
  }
  if (isBuildTarget(buildTarget)) {
    config.buildTarget = buildTarget
  }
  if (isLocaleID(defaultLocale)) {
    config.defaultLocale = defaultLocale
  }
  if (util.isArray(locales)) {
    locales.filter(id => !isLocaleID(id)).forEach(id => log.warn(`invalid locale ID '${id}'`))
    config.locales = Array.from(new Set(locales.filter(isLocaleID)))
  }
  if (typeof ssr === 'boolean') {
    config.ssr = ssr
  } else if (util.isPlainObject(ssr)) {
    const include = util.isArray(ssr.include) ? ssr.include.map(v => util.isNEString(v) ? new RegExp(v) : v).filter(v => v instanceof RegExp) : []
    const exclude = util.isArray(ssr.exclude) ? ssr.exclude.map(v => util.isNEString(v) ? new RegExp(v) : v).filter(v => v instanceof RegExp) : []
    config.ssr = { include, exclude }
  }
  if (util.isPlainObject(rewrites)) {
    config.rewrites = toPlainStringRecord(rewrites)
  }
  if (util.isPlainObject(headers)) {
    config.headers = toPlainStringRecord(headers)
  }
  if (util.isPlainObject(env)) {
    config.env = toPlainStringRecord(env)
    Object.entries(env).forEach(([key, value]) => Deno.env.set(key, value))
  }
  if (util.isNEArray(plugins)) {
    config.plugins = plugins
  }
  if (isPostcssConfig(postcss)) {
    config.postcss = postcss
  } else {
    config.postcss = await loadPostCSSConfig(workingDir)
  }

  return config
}



/** load import maps from `import_map.json` */
export async function loadImportMap(workingDir: string): Promise<ImportMap> {
  const importMap: ImportMap = { imports: {}, scopes: {} }
  for (const filename of Array.from(['import_map', 'import-map', 'importmap']).map(name => `${name}.json`)) {
    const importMapFile = join(workingDir, filename)
    if (existsFileSync(importMapFile)) {
      const data = JSON.parse(await Deno.readTextFile(importMapFile))
      const imports: Record<string, string> = toPlainStringRecord(data.imports)
      const scopes: Record<string, Record<string, string>> = {}
      if (util.isPlainObject(data.scopes)) {
        Object.entries(data.scopes).forEach(([scope, imports]) => {
          scopes[scope] = toPlainStringRecord(imports)
        })
      }
      Object.assign(importMap, { imports, scopes })
      break
    }
  }

  // update import map for alephjs dev env
  const DEV_PORT = Deno.env.get('ALEPH_DEV_PORT')
  if (DEV_PORT) {
    const alephPkgUri = getAlephPkgUri()
    const imports = {
      'framework': `${alephPkgUri}/framework/core/mod.ts`,
      'framework/react': `${alephPkgUri}/framework/react/mod.ts`,
      'react': `https://esm.sh/react@${defaultReactVersion}`,
      'react-dom': `https://esm.sh/react-dom@${defaultReactVersion}`,
    }
    Object.assign(importMap.imports, imports)
  }

  return importMap
}

async function loadPostCSSConfig(workingDir: string): Promise<{ plugins: PostCSSPlugin[] }> {
  for (const name of Array.from(['ts', 'js', 'json']).map(ext => `postcss.config.${ext}`)) {
    const p = join(workingDir, name)
    if (existsFileSync(p)) {
      let config: any = null
      if (name.endsWith('.json')) {
        config = JSON.parse(await Deno.readTextFile(p))
      } else {
        const mod = await import('file://' + p)
        config = mod.default
        if (util.isFunction(config)) {
          config = await config()
        }
      }
      if (isPostcssConfig(config)) {
        return config
      }
    }
  }

  return { plugins: ['autoprefixer'] }
}

function isFramework(v: any): v is 'react' {
  switch (v) {
    case 'react':
      return true
    default:
      return false
  }
}

function isBuildTarget(v: any): v is 'es2015' | 'es2016' | 'es2017' | 'es2018' | 'es2019' | 'es2020' {
  switch (v) {
    case 'es2015':
    case 'es2016':
    case 'es2017':
    case 'es2018':
    case 'es2019':
    case 'es2020':
      return true
    default:
      return false
  }
}

function isPostcssConfig(v: any): v is { plugins: PostCSSPlugin[] } {
  return util.isPlainObject(v) && util.isArray(v.plugins)
}

function isLocaleID(v: any): v is string {
  return util.isNEString(v) && reLocaleID.test(v)
}

function toPlainStringRecord(v: any) {
  const imports: Record<string, string> = {}
  if (util.isPlainObject(v)) {
    Object.entries(v).forEach(([key, value]) => {
      if (key == '') {
        return
      }
      if (util.isNEString(value)) {
        imports[key] = value
        return
      } else if (util.isNEArray(value)) {
        for (const v of value) {
          if (util.isNEString(v)) {
            imports[key] = v
            return
          }
        }
      }
    })
  }
  return imports
}
