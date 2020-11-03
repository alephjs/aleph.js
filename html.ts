import util from './util.ts'

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
                }
                return `<link rel="preload" href=${JSON.stringify(v.src)} as="script" />`
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
