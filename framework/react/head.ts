import type { PropsWithChildren, ReactNode } from 'https://esm.sh/react'
import { Children, Fragment, isValidElement, useContext, useEffect } from 'https://esm.sh/react'
import util from '../../shared/util.ts'
import { RendererContext } from './context.ts'
import Script from './script.ts'

export default function Head(props: PropsWithChildren<{}>) {
    const renderer = useContext(RendererContext)

    if (util.inDeno()) {
        parse(props.children).forEach(({ type, props }, key) => renderer.headElements.set(key, { type, props }))
    }

    useEffect(() => {
        const doc = (window as any).document
        const nodes = parse(props.children)
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
                if (type === 'script') {
                    return
                }
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
    }, [props.children])

    return null
}

function parse(node: ReactNode, els: Map<string, { type: string, props: Record<string, any> }> = new Map()) {
    Children.forEach(node, child => {
        if (!isValidElement(child)) {
            return
        }

        let { type, props } = child
        switch (type) {
            case Fragment:
                parse(props.children, els)
                break
            case Script:
                type = "script"
            case 'base':
            case 'title':
            case 'meta':
            case 'link':
            case 'style':
            case 'script':
            case 'no-script':
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
                    key += '-' + (els.size + 1)
                }
                // remove the children prop of base/meta/link
                if (['base', 'meta', 'link'].includes(type) && 'children' in props) {
                    const { children, ...rest } = props
                    els.set(key, { type, props: rest })
                } else {
                    els.set(key, { type, props })
                }
                break
        }
    })

    return els
}
