import { bold } from 'https://deno.land/std@0.94.0/fmt/colors.ts'
import { basename, join } from 'https://deno.land/std@0.94.0/path/mod.ts'
import type { ReactResolve } from '../compiler/mod.ts'
import { defaultReactVersion } from '../shared/constants.ts'
import { existsDirSync, existsFileSync } from '../shared/fs.ts'
import log from '../shared/log.ts'
import util from '../shared/util.ts'
import cssLoader from '../plugins/css.ts'
import type { Config, ImportMap, PostCSSPlugin } from '../types.ts'
import { VERSION } from '../version.ts'
import { getAlephPkgUri, reLocaleID } from './helper.ts'

export type RequiredConfig = Required<Config> & {
  react: ReactResolve
}

export function getDefaultConfig(): Readonly<RequiredConfig> {
  return {
    framework: 'react',
    buildTarget: 'es2015',
    browserslist: {},
    basePath: '/',
    srcDir: '/',
    outputDir: '/dist',
    defaultLocale: 'en',
    locales: [],
    rewrites: {},
    ssr: {},
    plugins: [],
    css: {},
    headers: {},
    compress: true,
    env: {},
    react: {
      version: defaultReactVersion,
      esmShBuildVersion: 41,
    }
  }
}

/** load config from `aleph.config.(ts|js|json)` */
export async function loadConfig(workingDir: string): Promise<Config> {
  let data: Record<string, any> = {}
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
    basePath,
    buildTarget,
    browserslist,
    defaultLocale,
    locales,
    ssr,
    rewrites,
    plugins,
    css,
    headers,
    compress,
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
  if (util.isNEString(basePath)) {
    config.basePath = util.cleanPath(basePath)
  }
  if (isBuildTarget(buildTarget)) {
    config.buildTarget = buildTarget
  }
  if (util.isPlainObject(browserslist)) {
    config.browserslist = browserslist
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
  if (typeof compress === 'boolean') {
    config.compress = compress
  }
  if (util.isPlainObject(env)) {
    config.env = toPlainStringRecord(env)
    Object.entries(env).forEach(([key, value]) => Deno.env.set(key, value))
  }
  if (util.isNEArray(plugins)) {
    config.plugins = [cssLoader(), ...plugins.filter(v => v && util.isNEString(v.type))]
  } else {
    config.plugins = [cssLoader()]
  }
  if (util.isPlainObject(css)) {
    const { extractSize, remoteExternal, modules, postcss } = css
    config.css = {
      extractSize: typeof extractSize === 'number' && !Number.isNaN(extractSize) ? extractSize : 8 * 1024,
      remoteExternal: Boolean(remoteExternal),
      modules: util.isPlainObject(modules) ? modules : Boolean(modules),
      postcss: isPostcssConfig(postcss) ? postcss : { plugins: ['autoprefixer'] }
    }
  }

  return config
}

/** load and upgrade the import maps from `import_map.json` */
export async function loadAndUpgradeImportMap(workingDir: string): Promise<ImportMap> {
  const importMap: ImportMap = { imports: {}, scopes: {} }
  let importMapFile = ''
  for (const filename of Array.from(['import_map', 'import-map', 'importmap']).map(name => `${name}.json`)) {
    importMapFile = join(workingDir, filename)
    if (existsFileSync(importMapFile)) {
      try {
        const data = JSON.parse(await Deno.readTextFile(importMapFile))
        const imports: Record<string, string> = toPlainStringRecord(data.imports)
        const scopes: Record<string, Record<string, string>> = {}
        if (util.isPlainObject(data.scopes)) {
          Object.entries(data.scopes).forEach(([scope, imports]) => {
            scopes[scope] = toPlainStringRecord(imports)
          })
        }
        Object.assign(importMap, { imports, scopes })
      } catch (e) {
        log.error(`invalid '${filename}':`, e.message)
        if (!confirm('Continue?')) {
          Deno.exit(1)
        }
      }
      break
    }
  }

  const upgrade: { name: string, url: string }[] = []
  for (const [name, url] of Object.entries(importMap.imports)) {
    if (url.startsWith('https://deno.land/x/aleph')) {
      const a = url.split('aleph')[1].split('/')
      const version = util.trimPrefix(a.shift()!, '@v')
      if (version !== VERSION && a.length > 0) {
        upgrade.push({ name, url: `https://deno.land/x/aleph@v${VERSION}/${a.join('/')}` })
      }
    }
  }

  if (upgrade.length > 0) {
    log.info(`upgraded ${basename(importMapFile)} to ${bold(VERSION)}`)
    upgrade.forEach(({ name, url }) => {
      importMap.imports[name] = url
    })
    await Deno.writeTextFile(importMapFile, JSON.stringify(importMap, undefined, 2))
  }

  const v = Deno.env.get('ALEPH_DEV')
  const alephPkgUri = getAlephPkgUri()
  const defaultImports: Record<string, string> = {
    'aleph/': `${alephPkgUri}/`,
    'framework': `${alephPkgUri}/framework/core/mod.ts`,
    'framework/react': `${alephPkgUri}/framework/react/mod.ts`,
    'react': `https://esm.sh/react@${defaultReactVersion}`,
    'react-dom': `https://esm.sh/react-dom@${defaultReactVersion}`
  }
  // in aleph dev mode, use default imports instead of app settings
  if (v !== undefined) {
    Object.assign(importMap.imports, defaultImports)
  } else {
    importMap.imports = Object.assign(defaultImports, importMap.imports,)
  }

  return importMap
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
