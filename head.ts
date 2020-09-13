import React, { Children, createElement, isValidElement, PropsWithChildren, ReactElement, ReactNode, useEffect } from 'https://esm.sh/react'
import util from './util.ts'

const serverHeadElements: Array<{ type: string, props: Record<string, any> }> = []
const serverStyles: Map<string, string> = new Map()

export function renderHead(styleModules?: string[]) {
    const tags: string[] = []
    serverHeadElements.forEach(({ type, props }) => {
        if (type === 'title') {
            if (util.isNEString(props.children)) {
                tags.push(`<title ssr>${props.children}</title>`)
            } else if (util.isNEArray(props.children)) {
                tags.push(`<title ssr>${props.children.join('')}</title>`)
            }
        } else {
            const attrs = Object.keys(props)
                .filter(key => key !== 'children')
                .map(key => ` ${key}=${JSON.stringify(props[key])}`)
                .join('')
            if (util.isNEString(props.children)) {
                tags.push(`<${type}${attrs} ssr>${props.children}</${type}>`)
            } else if (util.isNEArray(props.children)) {
                tags.push(`<${type}${attrs} ssr>${props.children.join('')}</${type}>`)
            } else {
                tags.push(`<${type}${attrs} ssr/>`)
            }
        }
    })
    styleModules?.forEach(id => {
        if (serverStyles.has(id)) {
            tags.push(`<style type="text/css" data-module-id=${JSON.stringify(id)}>\n${serverStyles.get(id)}</style>`)
        }
    })
    serverHeadElements.splice(0, serverHeadElements.length)
    return tags
}

export function applyCSS(id: string, css: string) {
    if (window.Deno) {
        serverStyles.set(id, css)
    } else {
        const { document } = (window as any)
        const textEl = document.createTextNode(css)
        const styleEl = document.createElement('style')
        const prevStyleEl = document.querySelector(`style[data-module-id=${JSON.stringify(id)}]`)
        styleEl.type = 'text/css'
        styleEl.setAttribute('data-module-id', id)
        styleEl.appendChild(textEl)
        document.head.appendChild(styleEl)
        if (prevStyleEl) {
            document.head.removeChild(prevStyleEl)
        }
    }
}

export default function Head({ children }: PropsWithChildren<{}>) {
    if (window.Deno) {
        parse(children).forEach(({ type, props }) => serverHeadElements.push({ type, props }))
    }

    useEffect(() => {
        const doc = (window as any).document
        const nodes = parse(children)
        const insertedEls: Array<Object> = []

        if (nodes.size > 0) {
            let charset = doc.querySelector('meta[charset]')
            if (!charset) {
                charset = doc.createElement('meta')
                charset.setAttribute('charset', 'utf-8')
                doc.head.prepend(charset)
            }

            const anchor = doc.createElement('meta')
            if (charset.nextElementSibling) {
                doc.head.insertBefore(anchor, charset.nextElementSibling)
            } else {
                doc.head.appendChild(anchor)
            }

            nodes.forEach(({ type, props }) => {
                const el = doc.createElement(type)
                Object.keys(props).forEach(key => {
                    const value = props[key]
                    if (key === 'children') {
                        if (util.isNEString(value)) {
                            el.innerText = value
                        } else if (util.isNEArray(value)) {
                            el.innerText = value.join('')
                        }
                    } else {
                        el.setAttribute(key, String(value || ''))
                    }
                })
                doc.head.insertBefore(el, anchor)
                insertedEls.push(el)
            })
            doc.head.removeChild(anchor)
        }

        return () => {
            insertedEls.forEach(el => doc.head.removeChild(el))
        }
    }, [children])

    return null
}

interface SEOProps {
    title: string
    description: string
    keywords?: string | string[]
    image?: string
    url?: string
}

export function SEO({ title, description, keywords, url, image }: SEOProps) {
    return createElement(
        Head,
        undefined,
        createElement('title', undefined, title),
        createElement('meta', { name: 'description', content: description }),
        keywords && createElement('meta', { name: 'keywords', content: util.isArray(keywords) ? keywords.join(',') : keywords }),
        createElement('meta', { name: 'og:title', content: title }),
        createElement('meta', { name: 'og:description', content: description }),
        url && createElement('meta', { name: 'og:url', content: url }),
        image && createElement('meta', { name: 'og:image', content: image }),
        url && createElement('meta', { name: 'twitter:site', content: url }),
        image && createElement('meta', { name: 'twitter:image', content: image }),
        image && createElement('meta', { name: 'twitter:card', content: 'summary_large_image' }),
    )
}

interface ViewportProps {
    width: number | 'device-width'
    height?: number | 'device-height'
    initialScale?: number
    minimumScale?: number
    maximumScale?: number
    userScalable?: boolean
    targetDensitydpi?: number | 'device-dpi' | 'low-dpi' | 'medium-dpi' | 'high-dpi'
}

export function Viewport(props: ViewportProps) {
    const content = Object.entries(props)
        .map(([key, value]) => {
            key = key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())
            if (value === true) {
                value = 'yes'
            } else if (value === false) {
                value = 'no'
            }
            return `${key}=${value}`
        })
        .join(',')
    return createElement(
        Head,
        undefined,
        createElement('meta', { name: 'viewport', content })
    )
}

function parse(node: ReactNode, els?: Map<string, { type: string, props: Record<string, any> }>) {
    if (els === undefined) {
        els = new Map()
    }

    Children.forEach(node, child => {
        if (!isValidElement(child)) {
            return
        }

        const { type, props } = child
        switch (type) {
            case React.Fragment:
                parse(props.children, els)
                break
            case SEO:
            case Viewport:
                parse((type(props) as ReactElement).props.children, els)
                break
            case 'base':
            case 'title':
            case 'meta':
            case 'link':
            case 'style':
            case 'script':
            case 'no-script':
                {
                    let key = type
                    if (type === 'meta') {
                        const propKeys = Object.keys(props).map(k => k.toLowerCase())
                        if (propKeys.includes('charset')) {
                            return // ignore charset, always use utf-8
                        }
                        if (propKeys.includes('name')) {
                            key += `[name=${JSON.stringify(props['name'])}]`
                        } else if (propKeys.includes('property')) {
                            key += `[property=${JSON.stringify(props['property'])}]`
                        } else if (propKeys.includes('http-equiv')) {
                            key += `[http-equiv=${JSON.stringify(props['http-equiv'])}]`
                        } else {
                            key += Object.keys(props).filter(k => !(/^content|children$/i.test(k))).map(k => `[${k.toLowerCase()}=${JSON.stringify(props[k])}]`).join('')
                        }
                    } else if (type !== 'title') {
                        key += '-' + (els!.size + 1)
                    }
                    // remove the children prop of base/meta/link
                    if (/^base|meta|link$/.test(type) && 'children' in props) {
                        const { children, ...rest } = props
                        els!.set(key, { type, props: rest })
                    } else {
                        els!.set(key, { type, props })
                    }
                }
                break
        }
    })

    return els!
}

