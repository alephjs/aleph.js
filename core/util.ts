import { colors, ensureDir, path, Sha1 } from '../deps.ts'
import util, { MB, reHashJs, reHttp, reMDExt, reModuleExt, reStyleModuleExt } from '../util.ts'
import { version } from '../version.ts'
import { ImportMap, Module } from './types.ts'

/* check whether or not the given path exists as a directory */
export async function existsDir(path: string) {
    try {
        const fi = await Deno.lstat(path)
        if (fi.isDirectory) {
            return true
        }
        return false
    } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
            return false
        }
        throw err
    }
}

/* check whether or not the given path exists as a directory */
export function existsDirSync(path: string) {
    try {
        const fi = Deno.lstatSync(path)
        if (fi.isDirectory) {
            return true
        }
        return false
    } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
            return false
        }
        throw err
    }
}

/* check whether or not the given path exists as regular file */
export async function existsFile(path: string) {
    try {
        const fi = await Deno.lstat(path)
        if (fi.isFile) {
            return true
        }
        return false
    } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
            return false
        }
        throw err
    }
}

/* check whether or not the given path exists as regular file */
export function existsFileSync(path: string) {
    try {
        const fi = Deno.lstatSync(path)
        if (fi.isFile) {
            return true
        }
        return false
    } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
            return false
        }
        throw err
    }
}

/** ensure and write a text file */
export async function ensureTextFile(name: string, content: string) {
    const dir = path.dirname(name)
    await ensureDir(dir)
    await Deno.writeTextFile(name, content)
}

/** returns a module by given url. */
export function moduleFromURL(url: string): Module {
    const isRemote = reHttp.test(url)
    const localUrl = fixImportUrl(url)
    const id = (isRemote ? '//' + util.trimPrefix(localUrl, '/-/') : localUrl).replace(reModuleExt, '.js')
    let loader = ''
    if (reStyleModuleExt.test(url)) {
        loader = 'css'
    } else if (reMDExt.test(url)) {
        loader = 'markdown'
    } else if (reModuleExt.test(url)) {
        loader = url.split('.').pop()!
        if (loader === 'mjs') {
            loader = 'js'
        }
    } else if (isRemote) {
        loader = 'js'
    }
    return {
        id,
        loader,
        url,
        isRemote,
        localUrl,
        sourceHash: '',
        hash: '',
        deps: [],
        jsFile: '',
        jsContent: '',
        jsSourceMap: null,
        error: null,
    } as Module
}

/** inject HMR and React Fast Referesh helper code  */
export function injectHmr({ id, localUrl, jsContent }: Module): string {
    const alephModuleLocalUrlPreifx = getAlephModuleLocalUrlPreifx()
    let hmrImportPath = getRelativePath(
        path.dirname(localUrl),
        `/-/${alephModuleLocalUrlPreifx}/hmr.js`
    )
    if (!hmrImportPath.startsWith('.') && !hmrImportPath.startsWith('/')) {
        hmrImportPath = './' + hmrImportPath
    }

    const lines = [
        `import { createHotContext, RefreshRuntime, performReactRefresh } from ${JSON.stringify(hmrImportPath)};`,
        `import.meta.hot = createHotContext(${JSON.stringify(id)});`
    ]
    const reactRefresh = id.endsWith('.js') || id.endsWith('.md') || id.endsWith('.mdx')
    if (reactRefresh) {
        lines.push('')
        lines.push(
            `const prevRefreshReg = window.$RefreshReg$;`,
            `const prevRefreshSig = window.$RefreshSig$;`,
            `Object.assign(window, {`,
            `    $RefreshReg$: (type, id) => RefreshRuntime.register(type, ${JSON.stringify(id)} + " " + id),`,
            `    $RefreshSig$: RefreshRuntime.createSignatureFunctionForTransform`,
            `});`,
        )
    }
    lines.push('')
    lines.push(jsContent)
    lines.push('')
    if (reactRefresh) {
        lines.push(
            'window.$RefreshReg$ = prevRefreshReg;',
            'window.$RefreshSig$ = prevRefreshSig;',
            'import.meta.hot.accept(performReactRefresh);'
        )
    } else {
        lines.push('import.meta.hot.accept();')
    }
    return lines.join('\n')
}

/** get Aleph.js module local URL preifx */
export function getAlephModuleLocalUrlPreifx(): string {
    const { __ALEPH_DEV_PORT: devPort } = globalThis as any
    return devPort ? `http_localhost_${devPort}` : `deno.land/x/aleph@v${version}`
}

/** get relative the path of `to` to `from` */
export function getRelativePath(from: string, to: string): string {
    let r = path.relative(from, to).split('\\').join('/')
    if (!r.startsWith('.') && !r.startsWith('/')) {
        r = './' + r
    }
    return r
}

/** fix import url */
export function fixImportUrl(importUrl: string): string {
    const isRemote = reHttp.test(importUrl)
    const url = new URL(isRemote ? importUrl : 'file://' + importUrl)
    let ext = path.extname(path.basename(url.pathname)) || '.js'
    if (isRemote && !reModuleExt.test(ext) && !reStyleModuleExt.test(ext) && !reMDExt.test(ext)) {
        ext = '.js'
    }
    let pathname = util.trimSuffix(url.pathname, ext)
    let search = Array.from(url.searchParams.entries()).map(([key, value]) => value ? `${key}=${value}` : key)
    if (search.length > 0) {
        pathname += '_' + search.join(',')
    }
    if (isRemote) {
        return [
            '/-/',
            (url.protocol === 'http:' ? 'http_' : ''),
            url.hostname,
            (url.port ? '_' + url.port : ''),
            pathname,
            ext
        ].join('')
    }
    const result = pathname + ext
    return !isRemote && importUrl.startsWith('/api/') ? decodeURI(result) : result;
}

/** fix import map */
export function fixImportMap(v: any) {
    const imports: ImportMap = {}
    if (util.isPlainObject(v)) {
        Object.entries(v).forEach(([key, value]) => {
            if (key == "" || key == "/") {
                return
            }
            const isPrefix = key.endsWith('/')
            const tmp: string[] = []
            if (util.isNEString(value)) {
                if (isPrefix && !value.endsWith('/')) {
                    return
                }
                tmp.push(value)
            } else if (util.isNEArray(value)) {
                value.forEach(v => {
                    if (util.isNEString(v)) {
                        if (isPrefix && !v.endsWith('/')) {
                            return
                        }
                        tmp.push(v)
                    }
                })
            }
            imports[key] = tmp
        })
    }
    return imports
}

/** get hash(sha1) of the content */
export function getHash(content: string | Uint8Array) {
    const sha1 = new Sha1()
    sha1.update(content)
    return sha1.hex()
}

/**
 * colorful the bytes string
 * - dim: 0 - 1MB
 * - yellow: 1MB - 10MB
 * - red: > 10MB
 */
export function colorfulBytesString(bytes: number) {
    let cf = colors.dim
    if (bytes > 10 * MB) {
        cf = colors.red
    } else if (bytes > MB) {
        cf = colors.yellow
    }
    return cf(util.bytesString(bytes))
}

/** cleanup the previous compilation cache */
export async function cleanupCompilation(jsFile: string) {
    const dir = path.dirname(jsFile)
    const jsFileName = path.basename(jsFile)
    if (!reHashJs.test(jsFile) || !existsDirSync(dir)) {
        return
    }
    const jsName = jsFileName.split('.').slice(0, -2).join('.') + '.js'
    for await (const entry of Deno.readDir(dir)) {
        if (entry.isFile && (entry.name.endsWith('.js') || entry.name.endsWith('.js.map'))) {
            const _jsName = util.trimSuffix(entry.name, '.map').split('.').slice(0, -2).join('.') + '.js'
            if (_jsName === jsName && jsFileName !== entry.name) {
                await Deno.remove(path.join(dir, entry.name))
            }
        }
    }
}

/** crate html content by given arguments */
export function createHtml({
    lang = 'en',
    head = [],
    scripts = [],
    body,
    minify = false
}: {
    lang?: string,
    head?: string[],
    scripts?: (string | { id?: string, type?: string, src?: string, innerText?: string, nomodule?: boolean, async?: boolean, preload?: boolean })[],
    body: string,
    minify?: boolean
}) {
    const eol = minify ? '' : '\n'
    const indent = minify ? '' : ' '.repeat(4)
    const headTags = head.map(tag => tag.trim())
        .concat(scripts.map(v => {
            if (!util.isString(v) && util.isNEString(v.src)) {
                if (v.type === 'module') {
                    return `<link rel="modulepreload" href=${JSON.stringify(v.src)} />`
                } else if (v.async === true) {
                    return `<link rel="preload" href=${JSON.stringify(v.src)} as="script" />`
                }
            }
            return ''
        })).filter(Boolean)
    const scriptTags = scripts.map(v => {
        if (util.isString(v)) {
            return `<script>${v}</script>`
        } else if (util.isNEString(v.innerText)) {
            const { innerText, ...rest } = v
            return `<script${attrString(rest)}>${eol}${innerText}${eol}${indent}</script>`
        } else if (util.isNEString(v.src) && !v.preload) {
            return `<script${attrString(v)}></script>`
        } else {
            return ''
        }
    }).filter(Boolean)

    return [
        '<!DOCTYPE html>',
        `<html lang="${lang}">`,
        '<head>',
        indent + '<meta charSet="utf-8" />',
        ...headTags.map(tag => indent + tag),
        '</head>',
        '<body>',
        indent + body,
        ...scriptTags.map(tag => indent + tag),
        '</body>',
        '</html>'
    ].join(eol)
}

function attrString(v: any): string {
    return Object.keys(v).map(k => {
        if (v[k] === true) {
            return ` ${k}`
        } else {
            return ` ${k}=${JSON.stringify(String(v[k]))}`
        }
    }).join('')
}
